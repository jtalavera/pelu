package com.cursorpoc.backend.whatsapp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.domain.FeatureFlag;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.Tier;
import com.cursorpoc.backend.domain.WhatsAppMessage;
import com.cursorpoc.backend.repository.ClientRepository;
import com.cursorpoc.backend.repository.FeatureFlagRepository;
import com.cursorpoc.backend.repository.PlatformAlertRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.repository.TierRepository;
import com.cursorpoc.backend.repository.WhatsAppMessageRepository;
import com.cursorpoc.backend.repository.WhatsAppOptOutRepository;
import com.cursorpoc.backend.repository.WhatsAppProcessedEventRepository;
import com.cursorpoc.backend.repository.WhatsAppTemplateStatusRepository;
import com.cursorpoc.backend.repository.WhatsAppUnreachableRepository;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * HU-WAP-03 / HU-WAP-07 against the real context and the fake provider: retries with 1/5/15 minute
 * waits, the one-time email fallback, unreachable numbers, consent and opt-outs at send time,
 * Meta's delivery statuses (out of order, repeated), and the retention masking.
 */
@SpringBootTest
@ActiveProfiles("test")
class WhatsAppDeliveryIntegrationTest {

  private static final AtomicLong SEQ = new AtomicLong();
  private static final String PHONE = "+595981123456";
  private static final String EMAIL = "ana@example.com";

  @Autowired WhatsAppOutbox outbox;
  @Autowired WhatsAppDispatcher dispatcher;
  @Autowired WhatsAppDeliveryService delivery;
  @Autowired WhatsAppWebhookProcessor webhook;
  @Autowired WhatsAppRetentionJob retention;
  @Autowired WhatsAppTemplateStatusService templateStatus;
  @Autowired WhatsAppConsentService consent;
  @Autowired FakeWhatsAppGateway gateway;
  @Autowired FakeFallbackEmailSender emails;
  @Autowired FeatureFlagRepository flags;
  @Autowired WhatsAppMessageRepository messages;
  @Autowired WhatsAppOptOutRepository optOuts;
  @Autowired WhatsAppUnreachableRepository unreachable;
  @Autowired WhatsAppProcessedEventRepository processed;
  @Autowired WhatsAppTemplateStatusRepository statusRepository;
  @Autowired PlatformAlertRepository alertRepository;
  @Autowired TenantRepository tenantRepository;
  @Autowired TierRepository tierRepository;
  @Autowired ClientRepository clientRepository;
  @Autowired PlatformTransactionManager txManager;

  private TransactionTemplate tx;
  private Tenant tenant;

  @BeforeEach
  void setUp() {
    tx = new TransactionTemplate(txManager);
    gateway.clear();
    emails.clear();
    optOuts.deleteAll();
    unreachable.deleteAll();
    statusRepository.deleteAll();
    alertRepository.deleteAll();
    setFlag(WhatsAppAccess.FLAG);
    setFlag(WhatsAppAccess.BOOKING_FLAG);
    templateStatus.refresh();

    Tier tier = new Tier();
    tier.setName("t-" + SEQ.incrementAndGet() + "-" + System.nanoTime());
    tier = tierRepository.save(tier);
    tenant = new Tenant();
    tenant.setName("Salón " + SEQ.incrementAndGet());
    tenant.setTier(tier);
    tenant = tenantRepository.save(tenant);
  }

  private void setFlag(String key) {
    FeatureFlag f = flags.findByFlagKey(key).orElseGet(FeatureFlag::new);
    f.setFlagKey(key);
    f.setEnabled(true);
    flags.save(f);
  }

  private long tenantId() {
    return tenant.getId();
  }

  private Client client(boolean optIn, String phone, boolean generic) {
    Client c = new Client();
    c.setTenant(tenant);
    c.setFullName("ANA");
    c.setPhone(phone);
    c.setActive(true);
    c.setGeneric(generic);
    c.setVisitCount(0);
    c.setWhatsappOptIn(optIn);
    c.setWhatsappOptInPhone(optIn ? phone : null);
    return clientRepository.save(c);
  }

  private WhatsAppOutboundMessage confirmed(String to) {
    return WhatsAppTemplate.TURNO_CONFIRMADO.message(
        to,
        List.of("María", "Salón Bella", "Corte", "viernes 28/11", "15:30", "Laura"),
        List.of(WhatsAppButton.url(0, "bella/turno/abc123")));
  }

  private long enqueue(String key, String to, Long clientId, String fallbackEmail) {
    return tx.execute(
            s ->
                outbox
                    .enqueue(
                        tenantId(), null, clientId, "BOOKING", confirmed(to), key, fallbackEmail)
                    .getId())
        .longValue();
  }

  private WhatsAppMessage row(long id) {
    return messages.findById(id).orElseThrow();
  }

  private WhatsAppMessage awaitStatus(long id, String... statuses) {
    await()
        .atMost(Duration.ofSeconds(10))
        .untilAsserted(() -> assertThat(row(id).getStatus()).isIn((Object[]) statuses));
    return row(id);
  }

  /** Makes the waiting retry due now and runs the sweep. */
  private void expedite(long id) {
    tx.executeWithoutResult(
        s -> {
          WhatsAppMessage m = row(id);
          m.setNextAttemptAt(Instant.now().minusSeconds(1));
          messages.save(m);
        });
    dispatcher.sweep();
  }

  private String key(String label) {
    return label + "-" + SEQ.incrementAndGet() + "-" + System.nanoTime();
  }

  // ── Retries (HU-WAP-07 criterio 3) ──────────────────────────────────────────────────────────

  @Test
  void aTransientFailure_isRetriedAfterOneMinute_andThenSent() {
    gateway.failNext(WhatsAppErrorCode.TRANSIENT, 1);
    long id = enqueue(key("retry"), PHONE, null, EMAIL);

    WhatsAppMessage waiting = awaitStatus(id, WhatsAppMessage.QUEUED);
    await().atMost(Duration.ofSeconds(5)).until(() -> row(id).getAttempts() == 1);
    waiting = row(id);
    assertThat(waiting.getErrorCode()).isEqualTo("TRANSIENT");
    assertThat(Duration.between(Instant.now(), waiting.getNextAttemptAt()).toSeconds())
        .isBetween(50L, 61L);
    assertThat(gateway.sentMessages()).isEmpty();

    expedite(id);

    WhatsAppMessage sent = awaitStatus(id, WhatsAppMessage.SENT);
    assertThat(sent.getAttempts()).isEqualTo(2);
    assertThat(sent.getMetaMessageId()).startsWith("wamid.");
    assertThat(gateway.sentMessages()).hasSize(1);
    assertThat(emails.sentEmails()).isEmpty();
  }

  @Test
  void theWaitsGrowOneFiveFifteenMinutes_andTheLastFailureFallsBackToEmail() {
    gateway.failNext(WhatsAppErrorCode.RATE_LIMITED, 4);
    long id = enqueue(key("backoff"), PHONE, null, EMAIL);

    long[] expectedMinutes = {1, 5, 15};
    for (int i = 0; i < 3; i++) {
      int attempt = i + 1;
      await().atMost(Duration.ofSeconds(10)).until(() -> row(id).getAttempts() == attempt);
      WhatsAppMessage m = awaitStatus(id, WhatsAppMessage.QUEUED);
      long seconds = Duration.between(Instant.now(), m.getNextAttemptAt()).toSeconds();
      assertThat(seconds).isBetween(expectedMinutes[i] * 60 - 10, expectedMinutes[i] * 60 + 1);
      expedite(id);
    }

    WhatsAppMessage failed = awaitStatus(id, WhatsAppMessage.FAILED);
    assertThat(failed.getAttempts()).isEqualTo(4);
    assertThat(failed.getErrorCode()).isEqualTo("RATE_LIMITED");
    await().atMost(Duration.ofSeconds(5)).until(() -> emails.sentEmails().size() == 1);
    assertThat(gateway.sentMessages()).isEmpty();
  }

  @Test
  void aDefinitiveFailure_isNotRetried_andSendsOneEmail() {
    gateway.failNext(WhatsAppErrorCode.AUTH_FAILED, 1);
    long id = enqueue(key("auth"), PHONE, null, EMAIL);

    WhatsAppMessage failed = awaitStatus(id, WhatsAppMessage.FAILED);

    assertThat(failed.getAttempts()).isEqualTo(1);
    assertThat(failed.getErrorCode()).isEqualTo("AUTH_FAILED");
    assertThat(failed.getFallbackEmailSentAt()).isNotNull();
    assertThat(emails.sentEmails()).hasSize(1);
    assertThat(emails.sentEmails().get(0).to()).isEqualTo(EMAIL);
    dispatcher.sweep();
    dispatcher.sweep();
    assertThat(emails.sentEmails()).hasSize(1);
  }

  @Test
  void withoutAnEmailAddress_aFailureIsOnlyRecorded() {
    gateway.failNext(WhatsAppErrorCode.AUTH_FAILED, 1);
    long id = enqueue(key("noemail"), PHONE, null, null);

    WhatsAppMessage failed = awaitStatus(id, WhatsAppMessage.FAILED);

    assertThat(failed.getFallbackEmailSentAt()).isNull();
    assertThat(emails.sentEmails()).isEmpty();
  }

  @Test
  void theFallbackEmailCarriesTheSameContentAndTheLink() {
    gateway.failNext(WhatsAppErrorCode.AUTH_FAILED, 1);
    long id = enqueue(key("content"), PHONE, null, EMAIL);
    awaitStatus(id, WhatsAppMessage.FAILED);

    FakeFallbackEmailSender.SentEmail mail = emails.sentEmails().get(0);

    assertThat(mail.subject()).isEqualTo("Tu turno está confirmado");
    assertThat(mail.body())
        .contains("Hola María, tu turno en Salón Bella está confirmado: Corte, el viernes 28/11")
        .contains("a las 15:30 con Laura.")
        .contains("con el enlace de abajo")
        .contains("Ver o cambiar turno: ")
        .contains("/r/bella/turno/abc123")
        .contains("no pudimos enviarte este aviso por WhatsApp")
        .doesNotContain("botón")
        .doesNotContain("981123456");
  }

  @Test
  void ifTheEmailItselfFails_theClaimIsReleased_andTheSweepSendsItOnce() {
    emails.failNext(1);
    gateway.failNext(WhatsAppErrorCode.AUTH_FAILED, 1);
    long id = enqueue(key("emailfail"), PHONE, null, EMAIL);

    WhatsAppMessage failed = awaitStatus(id, WhatsAppMessage.FAILED);
    await()
        .atMost(Duration.ofSeconds(5))
        .untilAsserted(() -> assertThat(row(id).getFallbackEmailSentAt()).isNull());
    assertThat(emails.sentEmails()).isEmpty();
    assertThat(failed.getFallbackEmail()).isEqualTo(EMAIL);

    dispatcher.sweep();
    dispatcher.sweep();

    assertThat(emails.sentEmails()).hasSize(1);
    assertThat(row(id).getFallbackEmailSentAt()).isNotNull();
  }

  @Test
  void aPausedTemplate_goesStraightToTheEmail() {
    gateway.setTemplateStatus("pelu_turno_confirmado", "PAUSED", "LOW_QUALITY");
    templateStatus.refresh();
    long id = enqueue(key("paused"), PHONE, null, EMAIL);

    WhatsAppMessage failed = awaitStatus(id, WhatsAppMessage.FAILED);

    assertThat(failed.getErrorCode()).isEqualTo("TEMPLATE_UNAVAILABLE");
    assertThat(failed.getAttempts()).isEqualTo(1);
    assertThat(gateway.sentMessages()).isEmpty();
    assertThat(emails.sentEmails()).hasSize(1);
  }

  @Test
  void theChannelBeingOff_fallsBackToEmail() {
    FeatureFlag f = flags.findByFlagKey(WhatsAppAccess.FLAG).orElseThrow();
    f.setEnabled(false);
    flags.save(f);
    try {
      long id = enqueue(key("off"), PHONE, null, EMAIL);
      WhatsAppMessage failed = awaitStatus(id, WhatsAppMessage.FAILED);
      assertThat(failed.getErrorCode()).isEqualTo("CHANNEL_UNAVAILABLE");
      assertThat(emails.sentEmails()).hasSize(1);
    } finally {
      f.setEnabled(true);
      flags.save(f);
    }
  }

  // ── Unreachable numbers (criterio 4) ───────────────────────────────────────────────────────

  @Test
  void aNumberWithoutWhatsApp_isRemembered_andNotTriedAgain() {
    gateway.failNext(WhatsAppErrorCode.INVALID_RECIPIENT, 1);
    long first = enqueue(key("nowa1"), PHONE, null, EMAIL);
    awaitStatus(first, WhatsAppMessage.FAILED);
    assertThat(unreachable.existsById(PHONE)).isTrue();
    assertThat(emails.sentEmails()).hasSize(1);

    long second = enqueue(key("nowa2"), PHONE, null, EMAIL);
    WhatsAppMessage failed = awaitStatus(second, WhatsAppMessage.FAILED);

    assertThat(failed.getErrorCode()).isEqualTo("INVALID_RECIPIENT");
    assertThat(gateway.sentMessages()).isEmpty();
    assertThat(failed.getAttempts()).isEqualTo(1);
    await().atMost(Duration.ofSeconds(5)).until(() -> emails.sentEmails().size() == 2);

    long other = enqueue(key("other"), "+595982000111", null, EMAIL);
    assertThat(awaitStatus(other, WhatsAppMessage.SENT).getMetaMessageId()).isNotBlank();
  }

  @Test
  void whenThePhoneChanges_theUnreachableMarkOfTheOldNumberIsMoot() {
    consent.markUnreachable(PHONE, "NO_WHATSAPP");
    assertThat(consent.blockFor(tenantId(), null, PHONE))
        .contains(WhatsAppConsentService.Block.UNREACHABLE);
    assertThat(consent.blockFor(tenantId(), null, "+595982000111")).isEmpty();
    consent.clearUnreachable(PHONE);
    assertThat(consent.blockFor(tenantId(), null, PHONE)).isEmpty();
  }

  // ── Consent and opt-outs at send time (HU-WAP-03, RT-11) ───────────────────────────────────

  @Test
  void aClientWithoutConsent_isNotSent_andGetsNoEmailEither() {
    Client c = client(false, PHONE, false);
    long id = enqueue(key("noconsent"), PHONE, c.getId(), EMAIL);

    WhatsAppMessage m = awaitStatus(id, WhatsAppMessage.CANCELLED);

    assertThat(m.getErrorCode()).isEqualTo("NO_CONSENT");
    assertThat(gateway.sentMessages()).isEmpty();
    assertThat(emails.sentEmails()).isEmpty();
  }

  @Test
  void aClientWithConsent_isSent() {
    Client c = client(true, PHONE, false);
    long id = enqueue(key("consent"), PHONE, c.getId(), EMAIL);

    assertThat(awaitStatus(id, WhatsAppMessage.SENT).getMetaMessageId()).startsWith("wamid.");
  }

  @Test
  void consentWithdrawnBeforeTheSend_cancelsTheQueuedMessage() {
    Client c = client(true, PHONE, false);
    long id =
        tx.execute(
            s -> {
              long mid =
                  outbox
                      .enqueue(
                          tenantId(),
                          null,
                          c.getId(),
                          "BOOKING",
                          confirmed(PHONE),
                          key("wd"),
                          EMAIL)
                      .getId();
              // The salon switches the consent off in the same transaction, before the send.
              Client fresh = clientRepository.findById(c.getId()).orElseThrow();
              fresh.setWhatsappOptIn(false);
              fresh.setWhatsappOptInPhone(null);
              clientRepository.save(fresh);
              return mid;
            });

    WhatsAppMessage m = awaitStatus(id, WhatsAppMessage.CANCELLED);

    assertThat(m.getErrorCode()).isEqualTo("NO_CONSENT");
    assertThat(gateway.sentMessages()).isEmpty();
    assertThat(emails.sentEmails()).isEmpty();
  }

  @Test
  void aConsentGivenForAnotherNumber_doesNotCover_thisOne() {
    Client c = client(true, "+595982000111", false);
    long id = enqueue(key("othernum"), PHONE, c.getId(), EMAIL);

    assertThat(awaitStatus(id, WhatsAppMessage.CANCELLED).getErrorCode()).isEqualTo("NO_CONSENT");
  }

  @Test
  void aPhoneThatOptedOut_isNeverSent_inAnySalon() {
    Client c = client(true, PHONE, false);
    consent.optOut(PHONE, "REPLY");
    long id = enqueue(key("optout"), PHONE, c.getId(), EMAIL);

    WhatsAppMessage m = awaitStatus(id, WhatsAppMessage.CANCELLED);

    assertThat(m.getErrorCode()).isEqualTo("OPTED_OUT");
    assertThat(gateway.sentMessages()).isEmpty();

    // Even a message without a registered client (an online booking) respects the opt-out.
    long anonymous = enqueue(key("optout2"), PHONE, null, EMAIL);
    assertThat(awaitStatus(anonymous, WhatsAppMessage.CANCELLED).getErrorCode())
        .isEqualTo("OPTED_OUT");

    consent.optIn(PHONE);
    long again = enqueue(key("optin"), PHONE, c.getId(), EMAIL);
    awaitStatus(again, WhatsAppMessage.SENT);
  }

  @Test
  void theGenericOccasionalClient_neverReceivesWhatsApp() {
    Client generic = client(true, PHONE, true);
    long id = enqueue(key("generic"), PHONE, generic.getId(), EMAIL);

    assertThat(awaitStatus(id, WhatsAppMessage.CANCELLED).getErrorCode())
        .isEqualTo("GENERIC_CLIENT");
  }

  // ── Delivery statuses (criterio 2) ─────────────────────────────────────────────────────────

  private long sentMessage() {
    long id = enqueue(key("status"), PHONE, null, EMAIL);
    awaitStatus(id, WhatsAppMessage.SENT);
    return id;
  }

  private void status(String wamid, String status, String errorCode) {
    String errors =
        errorCode == null ? "" : ",\"errors\":[{\"code\":" + errorCode + ",\"title\":\"x\"}]";
    webhook.process(
        ("{\"entry\":[{\"changes\":[{\"field\":\"messages\",\"value\":{\"statuses\":[{\"id\":\""
                + wamid
                + "\",\"status\":\""
                + status
                + "\",\"timestamp\":\"1700000000\""
                + errors
                + "}]}}]}]}")
            .getBytes());
  }

  @Test
  void statusesAdvance_sentDeliveredRead() {
    long id = sentMessage();
    String wamid = row(id).getMetaMessageId();

    status(wamid, "delivered", null);
    assertThat(row(id).getStatus()).isEqualTo(WhatsAppMessage.DELIVERED);
    assertThat(row(id).getDeliveredAt()).isNotNull();

    status(wamid, "read", null);
    assertThat(row(id).getStatus()).isEqualTo(WhatsAppMessage.READ);
    assertThat(row(id).getReadAt()).isNotNull();
  }

  @Test
  void statusesArrivingOutOfOrder_neverGoBackwards() {
    long id = sentMessage();
    String wamid = row(id).getMetaMessageId();

    status(wamid, "read", null);
    status(wamid, "delivered", null);
    status(wamid, "sent", null);

    WhatsAppMessage m = row(id);
    assertThat(m.getStatus()).isEqualTo(WhatsAppMessage.READ);
    assertThat(m.getReadAt()).isNotNull();
    assertThat(m.getDeliveredAt()).isNotNull(); // a read implies it was delivered
  }

  @Test
  void aRepeatedNotification_isHandledOnce() {
    long id = sentMessage();
    String wamid = row(id).getMetaMessageId();

    status(wamid, "delivered", null);
    Instant firstDelivered = row(id).getDeliveredAt();
    status(wamid, "delivered", null);
    status(wamid, "delivered", null);

    assertThat(row(id).getDeliveredAt()).isEqualTo(firstDelivered);
    assertThat(processed.existsById(wamid + ":delivered")).isTrue();
  }

  @Test
  void aFailureAfterDelivery_isIgnored() {
    long id = sentMessage();
    String wamid = row(id).getMetaMessageId();
    status(wamid, "delivered", null);

    status(wamid, "failed", "131026");

    assertThat(row(id).getStatus()).isEqualTo(WhatsAppMessage.DELIVERED);
    assertThat(emails.sentEmails()).isEmpty();
    assertThat(unreachable.existsById(PHONE)).isFalse();
  }

  @Test
  void aNotDeliveredStatus_failsTheMessage_andSendsTheEmailOnce() {
    long id = sentMessage();
    String wamid = row(id).getMetaMessageId();

    status(wamid, "failed", "131049");
    status(wamid, "failed", "131049");

    WhatsAppMessage m = row(id);
    assertThat(m.getStatus()).isEqualTo(WhatsAppMessage.FAILED);
    assertThat(m.getFailedAt()).isNotNull();
    assertThat(m.getFallbackEmailSentAt()).isNotNull();
    assertThat(emails.sentEmails()).hasSize(1);
  }

  @Test
  void aNotDeliveredBecauseTheNumberHasNoWhatsApp_marksItUnreachable() {
    long id = sentMessage();

    status(row(id).getMetaMessageId(), "failed", "131026");

    assertThat(row(id).getErrorCode()).isEqualTo("INVALID_RECIPIENT");
    assertThat(unreachable.existsById(PHONE)).isTrue();
    assertThat(emails.sentEmails()).hasSize(1);
  }

  @Test
  void aStatusOfAMessageWeNeverSent_isIgnored() {
    status("wamid.NOT_OURS", "delivered", null);
    status("wamid.NOT_OURS", "failed", "131026");

    assertThat(emails.sentEmails()).isEmpty();
    assertThat(unreachable.count()).isZero();
  }

  @Test
  void theTenantComesFromOurRecord_notFromTheRequest() {
    long id = sentMessage();
    WhatsAppDeliveryService.Outcome o =
        delivery.applyStatus(row(id).getMetaMessageId(), "delivered", null, null);

    assertThat(o.tenantId()).isEqualTo(tenantId());
  }

  // ── Retention (criterio 9) ─────────────────────────────────────────────────────────────────

  @Test
  void afterTheRetentionPeriod_theRecipientIsMasked_andTheCountsStay() {
    long old = sentMessage();
    long recent = sentMessage();
    tx.executeWithoutResult(
        s -> {
          WhatsAppMessage m = row(old);
          m.setQueuedAt(Instant.now().minus(Duration.ofDays(100)));
          messages.save(m);
        });

    retention.run();

    WhatsAppMessage masked = row(old);
    assertThat(masked.getRecipient()).isEqualTo("+595******456");
    assertThat(masked.getFallbackEmail()).isNull();
    assertThat(masked.getPayload()).isEqualTo("{}");
    assertThat(masked.getRecipientMaskedAt()).isNotNull();
    assertThat(masked.getTemplate()).isEqualTo("pelu_turno_confirmado");
    assertThat(masked.getStatus()).isEqualTo(WhatsAppMessage.SENT);
    assertThat(row(recent).getRecipient()).isEqualTo(PHONE);
    assertThat(row(recent).getFallbackEmail()).isEqualTo(EMAIL);

    retention.run(); // idempotent
    assertThat(row(old).getRecipient()).isEqualTo("+595******456");
  }

  @Test
  void aWaitingRetry_isNeverMasked() {
    gateway.failNext(WhatsAppErrorCode.TRANSIENT, 1);
    long id = enqueue(key("waiting"), PHONE, null, EMAIL);
    await().atMost(Duration.ofSeconds(10)).until(() -> row(id).getAttempts() == 1);
    tx.executeWithoutResult(
        s -> {
          WhatsAppMessage m = row(id);
          m.setQueuedAt(Instant.now().minus(Duration.ofDays(100)));
          messages.save(m);
        });

    retention.run();

    assertThat(row(id).getRecipient()).isEqualTo(PHONE);
  }
}
