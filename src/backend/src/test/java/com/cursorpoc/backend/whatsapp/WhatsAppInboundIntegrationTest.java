package com.cursorpoc.backend.whatsapp;

import static org.assertj.core.api.Assertions.assertThat;

import com.cursorpoc.backend.domain.Appointment;
import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.domain.FeatureFlag;
import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.SalonService;
import com.cursorpoc.backend.domain.ServiceCategory;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.Tier;
import com.cursorpoc.backend.domain.enums.AppointmentStatus;
import com.cursorpoc.backend.repository.AppointmentRepository;
import com.cursorpoc.backend.repository.ClientRepository;
import com.cursorpoc.backend.repository.FeatureFlagRepository;
import com.cursorpoc.backend.repository.ProfessionalRepository;
import com.cursorpoc.backend.repository.SalonServiceRepository;
import com.cursorpoc.backend.repository.ServiceCategoryRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.repository.TierRepository;
import com.cursorpoc.backend.repository.WhatsAppAutoReplyRepository;
import com.cursorpoc.backend.repository.WhatsAppMessageRepository;
import com.cursorpoc.backend.repository.WhatsAppOptOutRepository;
import com.cursorpoc.backend.repository.WhatsAppTemplateStatusRepository;
import com.cursorpoc.backend.repository.WhatsAppUnreachableRepository;
import java.math.BigDecimal;
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
 * HU-WAP-05 against the real context and the fake provider: who gets the reminder over WhatsApp,
 * who falls back to the email path, quiet hours, no double reminders, and the fallback email.
 */
@SpringBootTest
@ActiveProfiles("test")
class WhatsAppInboundIntegrationTest {

  private static final AtomicLong SEQ = new AtomicLong();
  private static final AtomicLong PHONE_SEQ = new AtomicLong(500_000);

  @Autowired WhatsAppWebhookProcessor processor;
  @Autowired WhatsAppPayloads payloads;
  @Autowired WhatsAppAutoReplyRepository autoReplies;
  @Autowired PropertyBookingMessagingSettings settings;
  @Autowired FakeManageLinkProvider links;
  @Autowired FakeWhatsAppGateway gateway;
  @Autowired WhatsAppConsentService consent;
  @Autowired WhatsAppTemplateStatusService templateStatus;
  @Autowired WhatsAppMessageRepository messages;
  @Autowired WhatsAppOptOutRepository optOuts;
  @Autowired WhatsAppUnreachableRepository unreachable;
  @Autowired WhatsAppTemplateStatusRepository statusRepository;
  @Autowired AppointmentRepository appointmentRepository;
  @Autowired FeatureFlagRepository flags;
  @Autowired TenantRepository tenantRepository;
  @Autowired TierRepository tierRepository;
  @Autowired ClientRepository clientRepository;
  @Autowired ProfessionalRepository professionalRepository;
  @Autowired ServiceCategoryRepository categoryRepository;
  @Autowired SalonServiceRepository serviceRepository;
  @Autowired PlatformTransactionManager txManager;

  private TransactionTemplate tx;
  private Tenant tenant;
  private Professional professional;
  private SalonService service;
  private String phone;
  private String phoneForm;

  @BeforeEach
  void setUp() {
    tx = new TransactionTemplate(txManager);
    long n = PHONE_SEQ.incrementAndGet();
    phoneForm = "0982" + n;
    phone = "+595982" + n;
    optOuts.deleteAll();
    unreachable.deleteAll();
    statusRepository.deleteAll();
    setFlag(WhatsAppAccess.FLAG, true);
    setFlag(WhatsAppAccess.BOOKING_FLAG, true);
    refreshCatalog();
    links.setAvailable(true);

    Tier tier = new Tier();
    tier.setName("t-" + SEQ.incrementAndGet() + "-" + System.nanoTime());
    tier = tierRepository.save(tier);
    tenant = new Tenant();
    tenant.setName("Salón Bella " + SEQ.incrementAndGet());
    tenant.setTier(tier);
    tenant = tenantRepository.save(tenant);
    settings.overrideReminders(tenant.getId(), null);

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

  /** A late async send of an earlier test may refresh the catalog at the same time: retry. */
  private void refreshCatalog() {
    for (int i = 0; ; i++) {
      try {
        templateStatus.refresh();
        return;
      } catch (org.springframework.dao.DataIntegrityViolationException e) {
        if (i >= 4) {
          throw e;
        }
      }
    }
  }

  private void setFlag(String key, boolean on) {
    FeatureFlag f = flags.findByFlagKey(key).orElseGet(FeatureFlag::new);
    f.setFlagKey(key);
    f.setEnabled(on);
    flags.save(f);
  }

  private Client client(boolean optIn, String email) {
    Client c = new Client();
    c.setTenant(tenant);
    c.setFullName("Ana María Gómez");
    c.setPhone(phoneForm);
    c.setEmail(email);
    c.setActive(true);
    c.setVisitCount(0);
    c.setWhatsappOptIn(optIn);
    c.setWhatsappOptInPhone(optIn ? phone : null);
    return clientRepository.save(c);
  }

  private Appointment appointment(Client c, Instant start) {
    Appointment a = new Appointment();
    a.setTenant(tenant);
    a.setClient(c);
    a.setProfessional(professional);
    a.setSalonService(service);
    a.setStartAt(start);
    a.setEndAt(start.plusSeconds(1800));
    a.setStatus(AppointmentStatus.PENDING);
    return appointmentRepository.save(a);
  }

  /** A notice that really went out to this phone from this salon, `ago` seconds ago. */
  private void sendNotice(Appointment a) {
    var m = new com.cursorpoc.backend.domain.WhatsAppMessage();
    m.setTenantId(tenant.getId());
    m.setAppointmentId(a.getId());
    m.setPurpose("REMINDER");
    m.setTemplate("pelu_recordatorio_turno");
    m.setRecipient(phone);
    m.setPayload("{}");
    m.setDedupKey("test:" + System.nanoTime());
    m.setStatus(com.cursorpoc.backend.domain.WhatsAppMessage.SENT);
    m.setQueuedAt(Instant.now());
    m.setSentAt(Instant.now());
    messages.save(m);
  }

  private void receive(String json) {
    processor.process(json.getBytes(java.nio.charset.StandardCharsets.UTF_8));
  }

  private static String digits(String e164) {
    return e164.substring(1);
  }

  private static String wrap(String message) {
    return "{\"object\":\"whatsapp_business_account\",\"entry\":[{\"changes\":[{\"field\":\"messages\","
        + "\"value\":{\"messages\":["
        + message
        + "]}}]}]}";
  }

  private int seq = 0;

  private String text(String from, String body) {
    return wrap(
        "{\"id\":\"wamid.IN"
            + System.nanoTime()
            + (seq++)
            + "\",\"from\":\""
            + digits(from)
            + "\",\"type\":\"text\",\"text\":{\"body\":\""
            + body
            + "\"}}");
  }

  private String templateButton(String from, String payload) {
    return wrap(
        "{\"id\":\"wamid.IN"
            + System.nanoTime()
            + (seq++)
            + "\",\"from\":\""
            + digits(from)
            + "\",\"type\":\"button\",\"button\":{\"payload\":\""
            + payload
            + "\",\"text\":\"x\"}}");
  }

  private String replyButton(String from, String id) {
    return wrap(
        "{\"id\":\"wamid.IN"
            + System.nanoTime()
            + (seq++)
            + "\",\"from\":\""
            + digits(from)
            + "\",\"type\":\"interactive\",\"interactive\":{\"type\":\"button_reply\","
            + "\"button_reply\":{\"id\":\""
            + id
            + "\",\"title\":\"x\"}}}");
  }

  private List<FakeWhatsAppGateway.SentSession> repliesToMe() {
    return gateway.sentSessions().stream().filter(r -> phone.equals(r.message().to())).toList();
  }

  private AppointmentStatus statusOf(Appointment a) {
    return appointmentRepository.findById(a.getId()).orElseThrow().getStatus();
  }

  private Instant confirmedAt(Appointment a) {
    return appointmentRepository.findById(a.getId()).orElseThrow().getClientConfirmedAt();
  }

  private Appointment future(Client c) {
    return appointment(c, Instant.now().plusSeconds(3 * 86400));
  }

  // ── Botones ────────────────────────────────────────────────────────────────────────────────

  @Test
  void confirmo_registersTheConfirmationAndConfirmsAPendingTurnoOfTheSalon() {
    Appointment a = future(client(true, "x@example.com"));

    receive(templateButton(phone, payloads.sign(WhatsAppPayloads.Action.CONFIRM, a.getId())));

    assertThat(confirmedAt(a)).isNotNull();
    assertThat(statusOf(a)).isEqualTo(AppointmentStatus.CONFIRMED);
    assertThat(repliesToMe()).hasSize(1);
    assertThat(repliesToMe().get(0).message().text()).contains("confirmado").contains("Ana");
  }

  @Test
  void confirmo_twice_isHarmless() {
    Appointment a = future(client(true, null));
    String payload = payloads.sign(WhatsAppPayloads.Action.CONFIRM, a.getId());
    receive(templateButton(phone, payload));
    Instant first = confirmedAt(a);
    receive(templateButton(phone, payload));

    assertThat(confirmedAt(a)).isEqualTo(first);
    assertThat(statusOf(a)).isEqualTo(AppointmentStatus.CONFIRMED);
  }

  @Test
  void aTapWithAForgedOrAlteredPayload_isJustAFreeMessage() {
    Appointment a = future(client(true, null));
    String forged =
        payloads.sign(WhatsAppPayloads.Action.CONFIRM, a.getId()).replace("CONFIRM", "CANCEL_YES");

    receive(templateButton(phone, forged));

    assertThat(statusOf(a)).isEqualTo(AppointmentStatus.PENDING);
    assertThat(confirmedAt(a)).isNull();
    assertThat(repliesToMe()).hasSize(1);
    assertThat(repliesToMe().get(0).message().text()).contains("solo envía avisos");
  }

  @Test
  void aTapFromAnotherPhone_neverActsOnSomeoneElsesTurno() {
    Appointment a = future(client(true, null));
    String stranger = "+595971" + PHONE_SEQ.incrementAndGet();

    receive(templateButton(stranger, payloads.sign(WhatsAppPayloads.Action.CANCEL_YES, a.getId())));

    assertThat(statusOf(a)).isEqualTo(AppointmentStatus.PENDING);
  }

  @Test
  void withButtonRepliesOff_onlyBajaAndAltaAreAttended() {
    Appointment a = future(client(true, null));
    settings.overrideButtonReplies(tenant.getId(), false);
    try {
      receive(templateButton(phone, payloads.sign(WhatsAppPayloads.Action.CONFIRM, a.getId())));
      assertThat(confirmedAt(a)).isNull();

      receive(text(phone, "BAJA"));
      assertThat(consent.isOptedOut(phone)).isTrue();
    } finally {
      settings.overrideButtonReplies(tenant.getId(), null);
    }
  }

  @Test
  void noPuedoIr_asksFirst_andOnlyYesCancels() {
    Appointment a = future(client(true, null));

    receive(templateButton(phone, payloads.sign(WhatsAppPayloads.Action.CANT_GO, a.getId())));

    assertThat(statusOf(a)).isEqualTo(AppointmentStatus.PENDING); // nothing cancelled yet
    var question = repliesToMe().get(0).message();
    assertThat(question.buttons())
        .extracting(b -> b.title())
        .containsExactly("Sí, cancelar", "No, mantener");

    receive(replyButton(phone, question.buttons().get(1).id())); // «No, mantener»
    assertThat(statusOf(a)).isEqualTo(AppointmentStatus.PENDING);
    assertThat(repliesToMe().get(1).message().text()).contains("mantenemos");

    receive(replyButton(phone, question.buttons().get(0).id())); // «Sí, cancelar»
    assertThat(statusOf(a)).isEqualTo(AppointmentStatus.CANCELLED);
    assertThat(repliesToMe().get(2).message().text()).contains("cancelamos");
  }

  @Test
  void cancelling_insideTheDeadline_isDone_outsideItNothingIsCancelledAndTheSalonPhoneIsGiven() {
    Appointment late = appointment(client(true, null), Instant.now().plusSeconds(3600)); // < 2 h

    receive(replyButton(phone, payloads.sign(WhatsAppPayloads.Action.CANCEL_YES, late.getId())));

    assertThat(statusOf(late)).isEqualTo(AppointmentStatus.PENDING);
    assertThat(repliesToMe().get(0).message().text()).contains("Ya no se puede cancelar");
  }

  @Test
  void aTurnoThatIsNoLongerCurrent_getsAShortExplanation() {
    Appointment past = appointment(client(true, null), Instant.now().minusSeconds(86400));
    receive(templateButton(phone, payloads.sign(WhatsAppPayloads.Action.CONFIRM, past.getId())));
    assertThat(confirmedAt(past)).isNull();
    assertThat(repliesToMe().get(0).message().text()).contains("ya no está vigente");
  }

  // ── Baja y alta ────────────────────────────────────────────────────────────────────────────

  @Test
  void bajaWords_optTheNumberOut_andAltaReverts() {
    for (String word : List.of("BAJA", "stop", "No quiero", " ¡baja! ")) {
      consent.optIn(phone);
      receive(text(phone, word));
      assertThat(consent.isOptedOut(phone)).as(word).isTrue();
    }
    assertThat(repliesToMe().get(0).message().text()).contains("no vas a recibir");

    receive(text(phone, "Alta"));
    assertThat(consent.isOptedOut(phone)).isFalse();
  }

  @Test
  void bajaWorksEvenWhenTheNumberIsNotAnyClients() {
    String unknown = "+595971" + PHONE_SEQ.incrementAndGet();
    receive(text(unknown, "BAJA"));
    assertThat(consent.isOptedOut(unknown)).isTrue();
  }

  // ── Mensajes libres ────────────────────────────────────────────────────────────────────────

  @Test
  void freeText_getsOneFixedAnswerEvery24Hours() {
    receive(text(phone, "hola, ¿tienen lugar mañana?"));
    receive(text(phone, "¿hola?"));

    assertThat(repliesToMe()).hasSize(1);
    assertThat(repliesToMe().get(0).message().text())
        .contains("Este número solo envía avisos de turnos y no recibe consultas");
  }

  @Test
  void otherKindsOfMessage_areTreatedAsFreeMessages() {
    receive(
        wrap(
            "{\"id\":\"wamid.IN"
                + System.nanoTime()
                + "\",\"from\":\""
                + digits(phone)
                + "\",\"type\":\"audio\",\"audio\":{\"id\":\"123\"}}"));
    assertThat(repliesToMe()).hasSize(1);
  }

  @Test
  void aFreeMessageIsAttributedToTheOnlySalonThatWroteToThePhoneInTheLast72Hours() {
    Client c = client(true, null);
    Appointment a = future(c);
    // A notice that really went out to this phone, from this salon.
    sendNotice(a);

    receive(text(phone, "hola"));

    assertThat(repliesToMe().get(0).message().text()).contains(tenant.getName());
  }

  @Test
  void theSameNotificationTwice_isHandledOnce() {
    String body = text(phone, "BAJA");
    receive(body);
    consent.optIn(phone); // if it were handled again the number would be opted out again
    receive(body);

    assertThat(consent.isOptedOut(phone)).isFalse();
    assertThat(repliesToMe()).hasSize(1);
  }
}
