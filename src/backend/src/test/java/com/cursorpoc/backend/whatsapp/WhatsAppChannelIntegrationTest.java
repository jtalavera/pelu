package com.cursorpoc.backend.whatsapp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.awaitility.Awaitility.await;

import com.cursorpoc.backend.domain.FeatureFlag;
import com.cursorpoc.backend.domain.WhatsAppMessage;
import com.cursorpoc.backend.repository.FeatureFlagRepository;
import com.cursorpoc.backend.repository.PlatformAlertRepository;
import com.cursorpoc.backend.repository.WhatsAppMessageRepository;
import com.cursorpoc.backend.repository.WhatsAppTemplateStatusRepository;
import java.time.Duration;
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
 * HU-WAP-01/02 against the real Spring context and the fake provider: the queued mode (after
 * commit, never on rollback, one message per event, a failed send never undoes the caller's
 * change), the flag and template gates, the synchronous code send, and the webhook-driven status
 * changes.
 */
@SpringBootTest
@ActiveProfiles("test")
class WhatsAppChannelIntegrationTest {

  private static final AtomicLong TENANT_SEQ = new AtomicLong(9_000);

  @Autowired WhatsAppOutbox outbox;
  @Autowired WhatsAppSender sender;
  @Autowired WhatsAppAccess access;
  @Autowired WhatsAppTemplateStatusService templateStatus;
  @Autowired PlatformAlertService alerts;
  @Autowired FakeWhatsAppGateway gateway;
  @Autowired FeatureFlagRepository flags;
  @Autowired WhatsAppMessageRepository messages;
  @Autowired PlatformAlertRepository alertRepository;
  @Autowired WhatsAppTemplateStatusRepository statusRepository;
  @Autowired PlatformTransactionManager txManager;
  @Autowired WhatsAppWebhookProcessor webhook;

  private long tenantId;
  private TransactionTemplate tx;

  @BeforeEach
  void setUp() {
    tenantId = TENANT_SEQ.incrementAndGet();
    tx = new TransactionTemplate(txManager);
    gateway.clear();
    statusRepository.deleteAll();
    alertRepository.deleteAll();
    setFlag(WhatsAppAccess.FLAG, true);
    setFlag(WhatsAppAccess.BOOKING_FLAG, true);
  }

  private void setFlag(String key, boolean on) {
    FeatureFlag f = flags.findByFlagKey(key).orElseGet(FeatureFlag::new);
    f.setFlagKey(key);
    f.setEnabled(on);
    flags.save(f);
  }

  private WhatsAppOutboundMessage confirmation() {
    return WhatsAppTemplate.TURNO_CONFIRMADO.message(
        "+595981123456",
        List.of("María", "Salón Bella", "Corte", "viernes 28/11", "15:30", "Laura"),
        List.of(WhatsAppButton.url(0, "bella/turno/abc123")));
  }

  private WhatsAppMessage waitForFinalStatus(String dedupKey) {
    await()
        .atMost(Duration.ofSeconds(10))
        .untilAsserted(
            () -> {
              WhatsAppMessage m =
                  messages.findByTenantIdAndDedupKey(tenantId, dedupKey).orElseThrow();
              assertThat(m.getStatus())
                  .isIn(WhatsAppMessage.SENT, WhatsAppMessage.FAILED, WhatsAppMessage.CANCELLED);
            });
    return messages.findByTenantIdAndDedupKey(tenantId, dedupKey).orElseThrow();
  }

  @Test
  void enqueue_isSentOnlyAfterTheCallersTransactionCommits() {
    String key = "appt:1:CONFIRMED:v1";

    tx.executeWithoutResult(
        s -> {
          outbox.enqueue(tenantId, 1L, null, "BOOKING", confirmation(), key);
          // Still inside the caller's transaction: row exists as QUEUED, nothing was sent.
          assertThat(gateway.sentMessages()).isEmpty();
        });

    WhatsAppMessage m = waitForFinalStatus(key);
    assertThat(m.getStatus()).isEqualTo(WhatsAppMessage.SENT);
    assertThat(m.getMetaMessageId()).startsWith("wamid.");
    assertThat(m.getSentAt()).isNotNull();
    assertThat(gateway.sentMessages()).hasSize(1);
    WhatsAppOutboundMessage sent = gateway.sentMessages().get(0).message();
    assertThat(sent.templateName()).isEqualTo("pelu_turno_confirmado");
    assertThat(sent.to()).isEqualTo("+595981123456");
    assertThat(sent.buttons()).containsExactly(WhatsAppButton.url(0, "bella/turno/abc123"));
  }

  @Test
  void enqueue_rolledBackTransaction_leavesNoMessageAndSendsNothing() throws Exception {
    String key = "appt:2:CONFIRMED:v1";

    assertThatThrownBy(
            () ->
                tx.executeWithoutResult(
                    s -> {
                      outbox.enqueue(tenantId, 2L, null, "BOOKING", confirmation(), key);
                      throw new IllegalStateException("the appointment could not be saved");
                    }))
        .isInstanceOf(IllegalStateException.class);

    Thread.sleep(500);
    assertThat(messages.findByTenantIdAndDedupKey(tenantId, key)).isEmpty();
    assertThat(gateway.sentMessages()).isEmpty();
  }

  @Test
  void enqueue_sameEventTwice_sendsOnce() {
    String key = "appt:3:CONFIRMED:v1";

    tx.executeWithoutResult(
        s -> {
          outbox.enqueue(tenantId, 3L, null, "BOOKING", confirmation(), key);
          outbox.enqueue(tenantId, 3L, null, "BOOKING", confirmation(), key);
        });
    tx.executeWithoutResult(
        s -> outbox.enqueue(tenantId, 3L, null, "BOOKING", confirmation(), key));

    waitForFinalStatus(key);
    assertThat(messages.findByTenantIdAndAppointmentIdOrderByIdDesc(tenantId, 3L)).hasSize(1);
    assertThat(gateway.sentMessages()).hasSize(1);
  }

  @Test
  void aFailedSend_isRecordedWithATypedCode_andNeverUndoesTheCallersChange() {
    String key = "appt:4:CONFIRMED:v1";
    gateway.failNext(WhatsAppErrorCode.INVALID_RECIPIENT, 1);

    tx.executeWithoutResult(
        s -> {
          // The business fact of the caller (any write) and the message share one transaction.
          alerts.raise("TEST_BUSINESS_FACT", "appointment-4", "created");
          outbox.enqueue(tenantId, 4L, null, "BOOKING", confirmation(), key);
        });

    WhatsAppMessage m = waitForFinalStatus(key);
    assertThat(m.getStatus()).isEqualTo(WhatsAppMessage.FAILED);
    assertThat(m.getErrorCode()).isEqualTo("INVALID_RECIPIENT");
    assertThat(m.getFailedAt()).isNotNull();
    assertThat(
            alertRepository.findFirstByCategoryAndSubjectAndAcknowledgedAtIsNull(
                "TEST_BUSINESS_FACT", "appointment-4"))
        .isPresent();
  }

  @Test
  void dispatch_withTheSalonsFlagOff_failsAsChannelUnavailableAndSendsNothing() {
    setFlag(WhatsAppAccess.FLAG, false);
    String key = "appt:5:CONFIRMED:v1";

    tx.executeWithoutResult(
        s -> outbox.enqueue(tenantId, 5L, null, "BOOKING", confirmation(), key));

    WhatsAppMessage m = waitForFinalStatus(key);
    assertThat(m.getStatus()).isEqualTo(WhatsAppMessage.FAILED);
    assertThat(m.getErrorCode()).isEqualTo("CHANNEL_UNAVAILABLE");
    assertThat(gateway.sentMessages()).isEmpty();
  }

  @Test
  void channel_needsBothFlags() {
    assertThat(access.isChannelAvailable(tenantId)).isTrue();
    setFlag(WhatsAppAccess.BOOKING_FLAG, false);
    assertThat(access.isChannelAvailable(tenantId)).isFalse();
    setFlag(WhatsAppAccess.BOOKING_FLAG, true);
    setFlag(WhatsAppAccess.FLAG, false);
    assertThat(access.isChannelAvailable(tenantId)).isFalse();
    assertThatThrownBy(() -> access.requireAvailable(tenantId))
        .isInstanceOfSatisfying(
            WhatsAppSendException.class,
            e -> assertThat(e.getCode()).isEqualTo(WhatsAppErrorCode.CHANNEL_UNAVAILABLE));
  }

  @Test
  void aPausedTemplate_isNeverUsed_andRaisesAnAlert() {
    gateway.setTemplateStatus("pelu_turno_confirmado", "PAUSED", "LOW_QUALITY");
    templateStatus.refresh();
    String key = "appt:6:CONFIRMED:v1";

    tx.executeWithoutResult(
        s -> outbox.enqueue(tenantId, 6L, null, "BOOKING", confirmation(), key));

    WhatsAppMessage m = waitForFinalStatus(key);
    assertThat(m.getStatus()).isEqualTo(WhatsAppMessage.FAILED);
    assertThat(m.getErrorCode()).isEqualTo("TEMPLATE_UNAVAILABLE");
    assertThat(gateway.sentMessages()).isEmpty();
    assertThat(alerts.listOpen())
        .anySatisfy(
            a -> {
              assertThat(a.getCategory()).isEqualTo("WHATSAPP_TEMPLATE_PAUSED");
              assertThat(a.getSubject()).isEqualTo("pelu_turno_confirmado");
            });
  }

  @Test
  void aTemplateThatRecovers_closesItsAlert() {
    gateway.setTemplateStatus("pelu_turno_cancelado", "REJECTED", "INCORRECT_CATEGORY");
    templateStatus.refresh();
    assertThat(alerts.listOpen()).hasSize(1);

    gateway.clear();
    templateStatus.refresh();

    assertThat(alerts.listOpen()).isEmpty();
  }

  @Test
  void aTemplateNotSubmittedToMeta_isMissing_andNotUsable() {
    gateway.clear();
    templateStatus.refresh();
    // Simulate Meta not knowing the template at all by marking it MISSING through the webhook path.
    templateStatus.applyWebhookEvent("pelu_turno_pendiente", "es", "DISABLED", "x");

    assertThat(templateStatus.isUsable("pelu_turno_pendiente", "es")).isFalse();
    assertThat(templateStatus.isUsable("pelu_turno_confirmado", "es")).isTrue();
    assertThat(templateStatus.isUsable("pelu_no_such_template", "es")).isFalse();
  }

  @Test
  void webhookStatusUpdate_pausesTheTemplate_andAlerts() {
    templateStatus.refresh();
    assertThat(templateStatus.isUsable("pelu_recordatorio_turno", "es")).isTrue();

    webhook.process(
        ("{\"entry\":[{\"changes\":[{\"field\":\"message_template_status_update\",\"value\":"
                + "{\"event\":\"PAUSED\",\"message_template_name\":\"pelu_recordatorio_turno\","
                + "\"message_template_language\":\"es\",\"reason\":\"NONE\"}}]}]}")
            .getBytes());

    assertThat(templateStatus.isUsable("pelu_recordatorio_turno", "es")).isFalse();
    assertThat(alerts.listOpen())
        .extracting(a -> a.getCategory() + "/" + a.getSubject())
        .contains("WHATSAPP_TEMPLATE_PAUSED/pelu_recordatorio_turno");

    webhook.process(
        ("{\"entry\":[{\"changes\":[{\"field\":\"message_template_status_update\",\"value\":"
                + "{\"event\":\"APPROVED\",\"message_template_name\":\"pelu_recordatorio_turno\","
                + "\"message_template_language\":\"es\"}}]}]}")
            .getBytes());
    assertThat(templateStatus.isUsable("pelu_recordatorio_turno", "es")).isTrue();
    assertThat(alerts.listOpen()).isEmpty();
  }

  @Test
  void webhookGarbage_neverThrows() {
    webhook.process("not json at all".getBytes());
    webhook.process(
        "{\"entry\":[{\"changes\":[{\"field\":\"messages\",\"value\":{}}]}]}".getBytes());
    webhook.process(
        ("{\"entry\":[{\"changes\":[{\"field\":\"message_template_status_update\",\"value\":"
                + "{\"event\":\"APPROVED\",\"message_template_name\":\"someone_elses_template\"}}]}]}")
            .getBytes());
  }

  @Test
  void verificationCode_isSentSynchronously_andRecordedWithoutTheCode() {
    WhatsAppSendResult result = sender.sendVerificationCode(tenantId, "0981 123 456", "482915");

    assertThat(result.wamid()).startsWith("wamid.");
    WhatsAppOutboundMessage sent = gateway.sentMessages().get(0).message();
    assertThat(sent.templateName()).isEqualTo("pelu_codigo_verificacion");
    assertThat(sent.to()).isEqualTo("+595981123456");
    assertThat(sent.bodyParameters()).containsExactly("482915");
    assertThat(sent.buttons()).containsExactly(WhatsAppButton.url(0, "482915"));

    List<WhatsAppMessage> rows =
        messages.findAll().stream().filter(m -> m.getTenantId() == tenantId).toList();
    assertThat(rows).hasSize(1);
    assertThat(rows.get(0).getPurpose()).isEqualTo("OTP");
    assertThat(rows.get(0).getStatus()).isEqualTo(WhatsAppMessage.SENT);
    assertThat(rows.get(0).getPayload()).doesNotContain("482915");
  }

  @Test
  void verificationCode_failureIsTyped_recorded_andNotRetried() {
    gateway.failNext(WhatsAppErrorCode.TRANSIENT, 1);

    assertThatThrownBy(() -> sender.sendVerificationCode(tenantId, "0981123456", "111222"))
        .isInstanceOfSatisfying(
            WhatsAppSendException.class,
            e -> assertThat(e.getCode()).isEqualTo(WhatsAppErrorCode.TRANSIENT));

    assertThat(gateway.sentMessages()).isEmpty();
    List<WhatsAppMessage> rows =
        messages.findAll().stream().filter(m -> m.getTenantId() == tenantId).toList();
    assertThat(rows).hasSize(1);
    assertThat(rows.get(0).getStatus()).isEqualTo(WhatsAppMessage.FAILED);
    assertThat(rows.get(0).getErrorCode()).isEqualTo("TRANSIENT");
  }

  @Test
  void verificationCode_invalidPhoneOrSalonWithoutTheChannel_isRejectedBeforeSending() {
    assertThatThrownBy(() -> sender.sendVerificationCode(tenantId, "021123456", "123456"))
        .isInstanceOfSatisfying(
            WhatsAppSendException.class,
            e -> assertThat(e.getCode()).isEqualTo(WhatsAppErrorCode.INVALID_RECIPIENT));

    setFlag(WhatsAppAccess.FLAG, false);
    assertThatThrownBy(() -> sender.sendVerificationCode(tenantId, "0981123456", "123456"))
        .isInstanceOfSatisfying(
            WhatsAppSendException.class,
            e -> assertThat(e.getCode()).isEqualTo(WhatsAppErrorCode.CHANNEL_UNAVAILABLE));
    assertThat(gateway.sentMessages()).isEmpty();
  }

  @Test
  void platformTestSend_usesExampleValues_forEveryTemplate() {
    for (WhatsAppTemplate t : WhatsAppTemplate.values()) {
      sender.sendPlatformTest("0981123456", t);
    }
    assertThat(gateway.sentMessages()).hasSize(WhatsAppTemplate.values().length);
    WhatsAppOutboundMessage reminder =
        gateway.sentMessages().stream()
            .map(FakeWhatsAppGateway.SentMessage::message)
            .filter(m -> m.templateName().equals("pelu_recordatorio_turno"))
            .findFirst()
            .orElseThrow();
    assertThat(reminder.bodyParameters())
        .containsExactly("María", "Salón Bella", "Corte y brushing", "viernes 28/11", "15:30");
    assertThat(reminder.buttons()).hasSize(3);
  }
}
