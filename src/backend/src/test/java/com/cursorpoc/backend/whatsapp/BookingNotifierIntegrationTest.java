package com.cursorpoc.backend.whatsapp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.awaitility.Awaitility.await;

import com.cursorpoc.backend.domain.Appointment;
import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.domain.FeatureFlag;
import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.SalonService;
import com.cursorpoc.backend.domain.ServiceCategory;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.Tier;
import com.cursorpoc.backend.domain.WhatsAppMessage;
import com.cursorpoc.backend.domain.enums.AppointmentStatus;
import com.cursorpoc.backend.repository.AppointmentRepository;
import com.cursorpoc.backend.repository.ClientRepository;
import com.cursorpoc.backend.repository.FeatureFlagRepository;
import com.cursorpoc.backend.repository.ProfessionalRepository;
import com.cursorpoc.backend.repository.SalonServiceRepository;
import com.cursorpoc.backend.repository.ServiceCategoryRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.repository.TierRepository;
import com.cursorpoc.backend.repository.WhatsAppMessageRepository;
import com.cursorpoc.backend.repository.WhatsAppOptOutRepository;
import com.cursorpoc.backend.repository.WhatsAppTemplateStatusRepository;
import com.cursorpoc.backend.repository.WhatsAppUnreachableRepository;
import com.cursorpoc.backend.service.AppointmentService;
import com.cursorpoc.backend.web.dto.AppointmentCreateRequest;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

/**
 * HU-WAP-04 (the booking-notice engine) against the real context and the fake provider: template
 * and variables per event, recipient and consent rules, one notice per event and schedule, queued
 * notices voided by a reschedule or a cancellation, email when WhatsApp cannot carry it, and the
 * transaction rules (after the commit, never on a rollback, a failed send never undoes the
 * booking).
 */
@SpringBootTest
@ActiveProfiles("test")
class BookingNotifierIntegrationTest {

  private static final AtomicLong SEQ = new AtomicLong();
  private static final AtomicLong PHONE_SEQ = new AtomicLong(100_000);
  private static final String LINK = "bella/turno/tok123";

  /** 15:30 on Friday 27/11/2026 in Asunción. */
  private static final Instant START = Instant.parse("2026-11-27T18:30:00Z");

  @Autowired BookingNotifier notifier;
  @Autowired PropertyBookingMessagingSettings settings;
  @Autowired AppointmentService appointmentService;
  @Autowired AppointmentRepository appointmentRepository;
  @Autowired FakeWhatsAppGateway gateway;
  @Autowired FakeFallbackEmailSender emails;
  @Autowired WhatsAppConsentService consent;
  @Autowired WhatsAppTemplateStatusService templateStatus;
  @Autowired WhatsAppMessageRepository messages;
  @Autowired WhatsAppOptOutRepository optOuts;
  @Autowired WhatsAppUnreachableRepository unreachable;
  @Autowired WhatsAppTemplateStatusRepository statusRepository;
  @Autowired FeatureFlagRepository flags;
  @Autowired TenantRepository tenantRepository;
  @Autowired TierRepository tierRepository;
  @Autowired ClientRepository clientRepository;
  @Autowired ProfessionalRepository professionalRepository;
  @Autowired ServiceCategoryRepository categoryRepository;
  @Autowired SalonServiceRepository serviceRepository;
  @Autowired PlatformTransactionManager txManager;

  /**
   * Phone and email are UNIQUE per test: the fake gateway and the fake email sender are singletons
   * shared with the other WhatsApp test classes of the same Spring context, and their asynchronous
   * sends can land at any time. Every assertion looks only at what went to THIS test's recipient.
   */
  private String phoneForm;

  private String phone;
  private String email;

  private TransactionTemplate tx;
  private Tenant tenant;
  private Professional professional;
  private SalonService service;

  @BeforeEach
  void setUp() {
    tx = new TransactionTemplate(txManager);
    long n = PHONE_SEQ.incrementAndGet();
    phoneForm = "0981" + n;
    phone = "+595981" + n;
    email = "ana" + n + "@example.com";
    gateway.clear();
    emails.clear();
    optOuts.deleteAll();
    unreachable.deleteAll();
    statusRepository.deleteAll();
    setFlag(WhatsAppAccess.FLAG, true);
    setFlag(WhatsAppAccess.BOOKING_FLAG, true);
    templateStatus.refresh();

    Tier tier = new Tier();
    tier.setName("t-" + SEQ.incrementAndGet() + "-" + System.nanoTime());
    tier = tierRepository.save(tier);
    tenant = new Tenant();
    tenant.setName("Salón Bella " + SEQ.incrementAndGet());
    tenant.setTier(tier);
    tenant = tenantRepository.save(tenant);
    settings.override(tenant.getId(), null);

    professional = new Professional();
    professional.setTenant(tenant);
    professional.setFullName("Laura");
    professional.setActive(true);
    professional = professionalRepository.save(professional);

    ServiceCategory category = new ServiceCategory();
    category.setTenant(tenant);
    category.setName("Cat " + System.nanoTime());
    category.setActive(true);
    category = categoryRepository.save(category);
    service = new SalonService();
    service.setTenant(tenant);
    service.setCategory(category);
    service.setName("Corte");
    service.setPriceMinor(new BigDecimal("50000"));
    service.setDurationMinutes(30);
    service.setActive(true);
    service = serviceRepository.save(service);
  }

  private void setFlag(String key, boolean on) {
    FeatureFlag f = flags.findByFlagKey(key).orElseGet(FeatureFlag::new);
    f.setFlagKey(key);
    f.setEnabled(on);
    flags.save(f);
  }

  private long tenantId() {
    return tenant.getId();
  }

  private Client client(String fullName, String phoneText, String emailText, boolean optIn) {
    Client c = new Client();
    c.setTenant(tenant);
    c.setFullName(fullName);
    c.setPhone(phoneText);
    c.setEmail(emailText);
    c.setActive(true);
    c.setVisitCount(0);
    c.setWhatsappOptIn(optIn);
    c.setWhatsappOptInPhone(optIn ? this.phone : null); // the consent is for THIS test's number
    return clientRepository.save(c);
  }

  private Appointment appointment(Client client, Instant start) {
    Appointment a = new Appointment();
    a.setTenant(tenant);
    a.setClient(client);
    a.setProfessional(professional);
    a.setSalonService(service);
    a.setStartAt(start);
    a.setEndAt(start.plusSeconds(1800));
    a.setStatus(AppointmentStatus.PENDING);
    return appointmentRepository.save(a);
  }

  private BookingNotifier.Outcome notifyNow(Appointment a, BookingEvent event, BookingContact c) {
    return tx.execute(s -> notifier.notify(tenantId(), a.getId(), event, c, LINK));
  }

  private BookingContact contactOf(Client c) {
    return tx.execute(
        s -> BookingContact.ofClient(clientRepository.findById(c.getId()).orElseThrow()));
  }

  private List<FakeWhatsAppGateway.SentMessage> sentToMe() {
    return gateway.sentMessages().stream().filter(m -> phone.equals(m.message().to())).toList();
  }

  private List<FakeFallbackEmailSender.SentEmail> emailsToMe() {
    return emails.sentEmails().stream().filter(e -> email.equals(e.to())).toList();
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

  private List<WhatsAppMessage> rowsOf(Appointment a) {
    return messages.findByTenantIdAndAppointmentIdOrderByIdDesc(tenantId(), a.getId());
  }

  // ── Template, variables and recipient (criterios 1, 2 y 7) ─────────────────────────────────

  @Test
  void confirmed_toAClientWithConsent_isSentWithTheTemplateOfTheEvent() {
    Client c = client("MARÍA JOSÉ GÓMEZ", phoneForm, email, true);
    Appointment a = appointment(c, START);

    BookingNotifier.Outcome out = notifyNow(a, BookingEvent.CONFIRMED, contactOf(c));

    assertThat(out.channel()).isEqualTo(BookingNotifier.Channel.WHATSAPP);
    assertThat(out.reason()).isNull();
    WhatsAppMessage m = awaitStatus(out.messageId(), WhatsAppMessage.SENT);
    assertThat(m.getPurpose()).isEqualTo("BOOKING");
    assertThat(m.getAppointmentId()).isEqualTo(a.getId());
    assertThat(m.getClientId()).isEqualTo(c.getId());
    assertThat(m.getDedupKey())
        .isEqualTo("appt:" + a.getId() + ":CONFIRMED:" + START.getEpochSecond());
    WhatsAppOutboundMessage sent = sentToMe().get(0).message();
    assertThat(sent.templateName()).isEqualTo("pelu_turno_confirmado");
    assertThat(sent.to()).isEqualTo(phone);
    assertThat(sent.bodyParameters())
        .containsExactly("María", tenant.getName(), "Corte", "viernes 27/11", "15:30", "Laura");
    assertThat(sent.buttons()).containsExactly(WhatsAppButton.url(0, LINK));
    assertThat(emailsToMe()).isEmpty();
  }

  @ParameterizedTest
  @EnumSource(BookingEvent.class)
  void eachEvent_usesItsOwnTemplate_withExactlyTheVariablesItNeeds(BookingEvent event) {
    Client c = client("ana lópez", phoneForm, email, true);
    Appointment a = appointment(c, START);

    BookingNotifier.Outcome out = notifyNow(a, event, contactOf(c));
    awaitStatus(out.messageId(), WhatsAppMessage.SENT);

    WhatsAppOutboundMessage sent = sentToMe().get(0).message();
    assertThat(sent.templateName()).isEqualTo(event.template().templateName());
    assertThat(sent.bodyParameters()).hasSize(event.template().bodyVariables());
    assertThat(sent.bodyParameters().subList(0, 4))
        .containsExactly("Ana", tenant.getName(), "Corte", "viernes 27/11");
    if (event == BookingEvent.PENDING || event == BookingEvent.CONFIRMED) {
      assertThat(sent.bodyParameters().get(4)).isEqualTo("15:30");
    }
    if (event == BookingEvent.CONFIRMED) {
      assertThat(sent.bodyParameters().get(5)).isEqualTo("Laura");
    }
    assertThat(sent.buttons()).containsExactly(WhatsAppButton.url(0, LINK));
  }

  @Test
  void theContentIsOnlyWhatTheTemplateCarries_neverAnAmountNorAnyOtherData() {
    Client c = client("Ana", phoneForm, email, true);
    Appointment a = appointment(c, START);

    BookingNotifier.Outcome out = notifyNow(a, BookingEvent.CONFIRMED, contactOf(c));
    awaitStatus(out.messageId(), WhatsAppMessage.SENT);

    String payload = row(out.messageId()).getPayload();
    assertThat(payload).doesNotContain("50000").doesNotContain(email).doesNotContain("981123456");
  }

  @Test
  void aTurnoOfTheOnlineBooking_goesToItsOwnVerifiedContact_notToTheClientsFile() {
    Client c =
        client("Ana", "0983 555 666", null, false); // the client's file: other phone, no consent
    Appointment a = appointment(c, START);

    BookingNotifier.Outcome out =
        notifyNow(
            a, BookingEvent.PENDING, BookingContact.online("paula ruiz", phoneForm, email, true));

    assertThat(out.channel()).isEqualTo(BookingNotifier.Channel.WHATSAPP);
    WhatsAppMessage m = awaitStatus(out.messageId(), WhatsAppMessage.SENT);
    assertThat(m.getClientId()).isNull(); // the booking's own consent is what counts
    WhatsAppOutboundMessage sent = sentToMe().get(0).message();
    assertThat(sent.to()).isEqualTo(phone);
    assertThat(sent.bodyParameters().get(0)).isEqualTo("Paula");
  }

  @Test
  void anOnlineContactThatOptedOutOfThePlatform_stillRespectsTheOptOut() {
    Client c = client("Ana", phoneForm, null, false);
    Appointment a = appointment(c, START);
    consent.optOut(phone, "REPLY");

    BookingNotifier.Outcome out =
        notifyNow(a, BookingEvent.PENDING, BookingContact.online("Ana", phoneForm, email, true));

    assertThat(out.channel()).isEqualTo(BookingNotifier.Channel.EMAIL);
    assertThat(out.reason()).isEqualTo("OPTED_OUT");
    assertThat(sentToMe()).isEmpty();
  }

  // ── One notice per event and schedule (criterio 3) ─────────────────────────────────────────

  @Test
  void theSameEventOfTheSameScheduleIsSentOnce_howeverManyTimesItIsRequested() {
    Client c = client("Ana", phoneForm, email, true);
    Appointment a = appointment(c, START);

    BookingNotifier.Outcome first = notifyNow(a, BookingEvent.CONFIRMED, contactOf(c));
    BookingNotifier.Outcome second = notifyNow(a, BookingEvent.CONFIRMED, contactOf(c));
    BookingNotifier.Outcome third =
        tx.execute(
            s -> {
              notifier.notify(tenantId(), a.getId(), BookingEvent.CONFIRMED, contactOf(c), LINK);
              return notifier.notify(
                  tenantId(), a.getId(), BookingEvent.CONFIRMED, contactOf(c), LINK);
            });

    assertThat(second.messageId()).isEqualTo(first.messageId());
    assertThat(third.messageId()).isEqualTo(first.messageId());
    awaitStatus(first.messageId(), WhatsAppMessage.SENT);
    assertThat(rowsOf(a)).hasSize(1);
    assertThat(sentToMe()).hasSize(1);
  }

  @Test
  void differentEventsOfTheSameTurno_areDifferentNotices() {
    Client c = client("Ana", phoneForm, email, true);
    Appointment a = appointment(c, START);

    BookingNotifier.Outcome pending = notifyNow(a, BookingEvent.PENDING, contactOf(c));
    BookingNotifier.Outcome confirmed = notifyNow(a, BookingEvent.CONFIRMED, contactOf(c));

    assertThat(confirmed.messageId()).isNotEqualTo(pending.messageId());
    awaitStatus(pending.messageId(), WhatsAppMessage.SENT);
    awaitStatus(confirmed.messageId(), WhatsAppMessage.SENT);
    assertThat(sentToMe()).hasSize(2);
  }

  // ── Reschedule and cancellation void what is queued (criterio 5) ───────────────────────────

  @Test
  void aReschedule_voidsTheQueuedNoticeOfTheOldTime_andSendsTheNewConfirmation() {
    Client c = client("Ana", phoneForm, email, true);
    Appointment a = appointment(c, START);
    gateway.failNext(WhatsAppErrorCode.TRANSIENT, 1); // keeps the first notice waiting in the queue
    BookingNotifier.Outcome old = notifyNow(a, BookingEvent.CONFIRMED, contactOf(c));
    await().atMost(Duration.ofSeconds(10)).until(() -> row(old.messageId()).getAttempts() == 1);
    assertThat(row(old.messageId()).getStatus()).isEqualTo(WhatsAppMessage.QUEUED);

    Instant later = START.plusSeconds(86_400L); // Saturday 28/11 15:30
    tx.executeWithoutResult(
        s -> {
          Appointment fresh = appointmentRepository.findById(a.getId()).orElseThrow();
          fresh.setStartAt(later);
          fresh.setEndAt(later.plusSeconds(1800));
          appointmentRepository.save(fresh);
        });
    BookingNotifier.Outcome fresh = notifyNow(a, BookingEvent.CONFIRMED, contactOf(c));

    assertThat(fresh.messageId()).isNotEqualTo(old.messageId());
    WhatsAppMessage voided = row(old.messageId());
    assertThat(voided.getStatus()).isEqualTo(WhatsAppMessage.CANCELLED);
    assertThat(voided.getErrorCode()).isEqualTo("SUPERSEDED");
    awaitStatus(fresh.messageId(), WhatsAppMessage.SENT);
    assertThat(sentToMe()).hasSize(1);
    assertThat(sentToMe().get(0).message().bodyParameters().get(3)).isEqualTo("sábado 28/11");
  }

  @Test
  void aCancellation_voidsEveryQueuedNotice_andTellsTheClient() {
    Client c = client("Ana", phoneForm, email, true);
    Appointment a = appointment(c, START);
    gateway.failNext(WhatsAppErrorCode.TRANSIENT, 1);
    BookingNotifier.Outcome waiting = notifyNow(a, BookingEvent.CONFIRMED, contactOf(c));
    await().atMost(Duration.ofSeconds(10)).until(() -> row(waiting.messageId()).getAttempts() == 1);

    BookingNotifier.Outcome cancelled = notifyNow(a, BookingEvent.CANCELLED, contactOf(c));

    assertThat(row(waiting.messageId()).getStatus()).isEqualTo(WhatsAppMessage.CANCELLED);
    assertThat(row(waiting.messageId()).getErrorCode()).isEqualTo("SUPERSEDED");
    awaitStatus(cancelled.messageId(), WhatsAppMessage.SENT);
    assertThat(sentToMe()).hasSize(1);
    assertThat(sentToMe().get(0).message().templateName()).isEqualTo("pelu_turno_cancelado");
  }

  @Test
  void aNoticeAlreadySent_isNotTouchedByALaterEvent() {
    Client c = client("Ana", phoneForm, email, true);
    Appointment a = appointment(c, START);
    BookingNotifier.Outcome sent = notifyNow(a, BookingEvent.CONFIRMED, contactOf(c));
    awaitStatus(sent.messageId(), WhatsAppMessage.SENT);

    BookingNotifier.Outcome cancelled = notifyNow(a, BookingEvent.CANCELLED, contactOf(c));
    awaitStatus(
        cancelled.messageId(),
        WhatsAppMessage.SENT); // its async send must not leak into the next test

    assertThat(row(sent.messageId()).getStatus()).isEqualTo(WhatsAppMessage.SENT);
  }

  // ── When WhatsApp cannot carry it: email, or only recorded (criterio 6) ─────────────────────

  @Test
  void withoutConsent_theNoticeGoesByEmailWithTheSameContent() {
    Client c = client("María", phoneForm, email, false);
    Appointment a = appointment(c, START);

    BookingNotifier.Outcome out = notifyNow(a, BookingEvent.CONFIRMED, contactOf(c));

    assertThat(out.channel()).isEqualTo(BookingNotifier.Channel.EMAIL);
    assertThat(out.reason()).isEqualTo("NO_CONSENT");
    await().atMost(Duration.ofSeconds(10)).until(() -> emailsToMe().size() == 1);
    FakeFallbackEmailSender.SentEmail mail = emailsToMe().get(0);
    assertThat(mail.to()).isEqualTo(email);
    assertThat(mail.subject()).isEqualTo("Tu turno está confirmado");
    assertThat(mail.body())
        .contains(
            "Hola María, tu turno en "
                + tenant.getName()
                + " está confirmado: Corte, el viernes 27/11")
        .contains("a las 15:30 con Laura.")
        .contains("/r/" + LINK);
    assertThat(sentToMe()).isEmpty();
    WhatsAppMessage m = row(out.messageId());
    assertThat(m.getStatus()).isEqualTo(WhatsAppMessage.FAILED);
    assertThat(m.getErrorCode()).isEqualTo("NO_CONSENT");
    assertThat(m.getAttempts()).isZero();
  }

  @Test
  void withoutConsentAndWithoutAnEmail_itIsOnlyRecorded_soTheSalonCanCall() {
    Client c = client("María", phoneForm, null, false);
    Appointment a = appointment(c, START);

    BookingNotifier.Outcome out = notifyNow(a, BookingEvent.CONFIRMED, contactOf(c));

    assertThat(out.channel()).isEqualTo(BookingNotifier.Channel.NONE);
    WhatsAppMessage m = row(out.messageId());
    assertThat(m.getStatus()).isEqualTo(WhatsAppMessage.FAILED);
    assertThat(m.getFallbackEmail()).isNull();
    assertThat(m.getFallbackEmailSentAt()).isNull();
    assertThat(emailsToMe()).isEmpty();
    assertThat(sentToMe()).isEmpty();
  }

  @Test
  void theUndeliverableNoticeIsAlsoDeduplicated_theEmailGoesOnce() {
    Client c = client("María", phoneForm, email, false);
    Appointment a = appointment(c, START);

    notifyNow(a, BookingEvent.CONFIRMED, contactOf(c));
    notifyNow(a, BookingEvent.CONFIRMED, contactOf(c));
    await().atMost(Duration.ofSeconds(10)).until(() -> emailsToMe().size() == 1);

    assertThat(rowsOf(a)).hasSize(1);
    assertThat(emailsToMe()).hasSize(1);
  }

  @Test
  void aPhoneThatCannotBeNormalized_goesByEmail() {
    Client c = client("Ana", "021 123 456", email, true); // a landline
    Appointment a = appointment(c, START);

    BookingNotifier.Outcome out = notifyNow(a, BookingEvent.CONFIRMED, contactOf(c));

    assertThat(out.channel()).isEqualTo(BookingNotifier.Channel.EMAIL);
    assertThat(out.reason()).isEqualTo("INVALID_PHONE");
    assertThat(row(out.messageId()).getRecipient()).isEqualTo("n/a");
  }

  @Test
  void aNumberWithoutWhatsApp_goesByEmail() {
    Client c = client("Ana", phoneForm, email, true);
    Appointment a = appointment(c, START);
    consent.markUnreachable(phone, "NO_WHATSAPP");

    BookingNotifier.Outcome out = notifyNow(a, BookingEvent.CONFIRMED, contactOf(c));

    assertThat(out.channel()).isEqualTo(BookingNotifier.Channel.EMAIL);
    assertThat(out.reason()).isEqualTo("UNREACHABLE");
  }

  @Test
  void theSalonsSwitchOff_sendsEverythingByEmail() {
    Client c = client("Ana", phoneForm, email, true);
    Appointment a = appointment(c, START);
    settings.override(tenantId(), false);

    BookingNotifier.Outcome out = notifyNow(a, BookingEvent.CONFIRMED, contactOf(c));

    assertThat(out.channel()).isEqualTo(BookingNotifier.Channel.EMAIL);
    assertThat(out.reason()).isEqualTo("NOTICES_DISABLED");
    assertThat(sentToMe()).isEmpty();
  }

  @Test
  void theChannelBeingOff_sendsEverythingByEmail() {
    Client c = client("Ana", phoneForm, email, true);
    Appointment a = appointment(c, START);
    FeatureFlag f = flags.findByFlagKey(WhatsAppAccess.FLAG).orElseThrow();
    f.setEnabled(false);
    flags.save(f);
    try {
      BookingNotifier.Outcome out = notifyNow(a, BookingEvent.CONFIRMED, contactOf(c));
      assertThat(out.channel()).isEqualTo(BookingNotifier.Channel.EMAIL);
      assertThat(out.reason()).isEqualTo("CHANNEL_UNAVAILABLE");
    } finally {
      f.setEnabled(true);
      flags.save(f);
    }
  }

  @Test
  void aPausedTemplate_endsUpByEmail() {
    Client c = client("Ana", phoneForm, email, true);
    Appointment a = appointment(c, START);
    gateway.setTemplateStatus("pelu_turno_confirmado", "PAUSED", "LOW_QUALITY");
    templateStatus.refresh();

    BookingNotifier.Outcome out = notifyNow(a, BookingEvent.CONFIRMED, contactOf(c));

    assertThat(out.channel()).isEqualTo(BookingNotifier.Channel.WHATSAPP); // tried first…
    awaitStatus(out.messageId(), WhatsAppMessage.FAILED);
    await().atMost(Duration.ofSeconds(10)).until(() -> emailsToMe().size() == 1); // …email after
    assertThat(row(out.messageId()).getErrorCode()).isEqualTo("TEMPLATE_UNAVAILABLE");
  }

  // ── Transaction rules (RT-14, criterio 4) ──────────────────────────────────────────────────

  @Test
  void theNoticeLeavesOnlyAfterTheCallersTransactionCommits() {
    Client c = client("Ana", phoneForm, email, true);
    Appointment a = appointment(c, START);

    tx.executeWithoutResult(
        s -> {
          BookingNotifier.Outcome out =
              notifier.notify(tenantId(), a.getId(), BookingEvent.CONFIRMED, contactOf(c), LINK);
          assertThat(out.channel()).isEqualTo(BookingNotifier.Channel.WHATSAPP);
          assertThat(sentToMe()).isEmpty();
        });

    await().atMost(Duration.ofSeconds(10)).until(() -> sentToMe().size() == 1);
  }

  @Test
  void aRolledBackBooking_leavesNoNoticeAndSendsNothing() throws Exception {
    Client c = client("Ana", phoneForm, email, true);
    Client noConsent = client("Luis", phoneForm, email, false);
    Appointment a = appointment(c, START);
    Appointment b = appointment(noConsent, START.plusSeconds(7200));

    assertThatThrownBy(
            () ->
                tx.executeWithoutResult(
                    s -> {
                      notifier.notify(
                          tenantId(), a.getId(), BookingEvent.CONFIRMED, contactOf(c), LINK);
                      notifier.notify(
                          tenantId(),
                          b.getId(),
                          BookingEvent.CONFIRMED,
                          contactOf(noConsent),
                          LINK);
                      throw new IllegalStateException("the booking could not be saved");
                    }))
        .isInstanceOf(IllegalStateException.class);

    Thread.sleep(600);
    assertThat(rowsOf(a)).isEmpty();
    assertThat(rowsOf(b)).isEmpty();
    assertThat(sentToMe()).isEmpty();
    assertThat(emailsToMe()).isEmpty();
  }

  @Test
  void aFailedSend_neverUndoesTheBookingThatCausedIt() {
    Client c = client("Ana", phoneForm, email, true);
    Appointment a = appointment(c, START);
    gateway.failNext(WhatsAppErrorCode.AUTH_FAILED, 1);

    tx.executeWithoutResult(
        s -> {
          Appointment fresh = appointmentRepository.findById(a.getId()).orElseThrow();
          fresh.setStatus(AppointmentStatus.CONFIRMED); // the business change of the caller
          appointmentRepository.save(fresh);
          notifier.notify(tenantId(), a.getId(), BookingEvent.CONFIRMED, contactOf(c), LINK);
        });

    WhatsAppMessage m = rowsOf(a).get(0);
    awaitStatus(m.getId(), WhatsAppMessage.FAILED);
    assertThat(appointmentRepository.findById(a.getId()).orElseThrow().getStatus())
        .isEqualTo(AppointmentStatus.CONFIRMED);
    await().atMost(Duration.ofSeconds(10)).until(() -> emailsToMe().size() == 1);
  }

  // ── What does NOT send (criterio 8) and bad calls ──────────────────────────────────────────

  @Test
  void creatingATurnoFromTheSalonsAgenda_sendsNoConfirmation() {
    Client c = client("Ana", phoneForm, email, true);
    Instant start = Instant.now().plusSeconds(3 * 86_400L);

    var created =
        appointmentService.create(
            tenantId(),
            new AppointmentCreateRequest(
                c.getId(), professional.getId(), service.getId(), start.toString(), null));

    assertThat(messages.findByTenantIdAndAppointmentIdOrderByIdDesc(tenantId(), created.id()))
        .isEmpty();
    assertThat(sentToMe()).isEmpty();
    assertThat(emailsToMe()).isEmpty();
  }

  @Test
  void aLinkIsRequired_andTheAppointmentMustBelongToTheSalon() {
    Client c = client("Ana", phoneForm, email, true);
    Appointment a = appointment(c, START);

    assertThatThrownBy(
            () -> notifier.notify(tenantId(), a.getId(), BookingEvent.CONFIRMED, contactOf(c), " "))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(
            () ->
                notifier.notify(
                    tenantId() + 100_000, a.getId(), BookingEvent.CONFIRMED, contactOf(c), LINK))
        .isInstanceOfSatisfying(
            ResponseStatusException.class,
            e -> assertThat(e.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND));
    assertThatThrownBy(
            () ->
                notifier.notify(
                    tenantId(), 987_654_321L, BookingEvent.CONFIRMED, contactOf(c), LINK))
        .isInstanceOf(ResponseStatusException.class);
  }
}
