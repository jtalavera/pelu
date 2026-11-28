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
import com.cursorpoc.backend.repository.WhatsAppMessageRepository;
import com.cursorpoc.backend.repository.WhatsAppOptOutRepository;
import com.cursorpoc.backend.repository.WhatsAppTemplateStatusRepository;
import com.cursorpoc.backend.repository.WhatsAppUnreachableRepository;
import com.cursorpoc.backend.service.AppointmentReminderService;
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
class WhatsAppReminderNotifierIntegrationTest {

  private static final AtomicLong SEQ = new AtomicLong();
  private static final AtomicLong PHONE_SEQ = new AtomicLong(500_000);

  @Autowired WhatsAppReminderNotifier notifier;
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
  @Autowired AppointmentReminderService reminderService;

  private TransactionTemplate tx;
  private Tenant tenant;
  private Professional professional;
  private SalonService service;
  private String phone;
  private String phoneForm;

  /** 12:00 UTC = 09:00 in Asunción: outside the quiet hours. */
  private static final Instant DAYTIME = Instant.parse("2031-03-05T12:00:00Z");

  /** 02:00 UTC = 23:00 the day before in Asunción: inside the quiet hours. */
  private static final Instant NIGHT = Instant.parse("2031-03-05T02:00:00Z");

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

  private WhatsAppReminderNotifier.Result run(Appointment a, Instant now) {
    return tx.execute(s -> notifier.tryWhatsApp(a.getId(), now));
  }

  private List<com.cursorpoc.backend.domain.WhatsAppMessage> queued(Appointment a) {
    return messages.findAll().stream().filter(m -> a.getId().equals(m.getAppointmentId())).toList();
  }

  private Instant reminderSentAt(Appointment a) {
    return appointmentRepository.findById(a.getId()).orElseThrow().getReminderSentAt();
  }

  @Test
  void consentedClient_getsTheReminderTemplateAndIsMarkedInTheSameStep() {
    Client c = client(true, "ana@example.com");
    Appointment a = appointment(c, DAYTIME.plusSeconds(20 * 3600));

    var result = run(a, DAYTIME);

    assertThat(result.outcome()).isEqualTo(WhatsAppReminderNotifier.Outcome.QUEUED);
    assertThat(reminderSentAt(a)).isNotNull();
    var rows = queued(a);
    assertThat(rows).hasSize(1);
    assertThat(rows.get(0).getPurpose()).isEqualTo("REMINDER");
    assertThat(rows.get(0).getFallbackEmail()).isEqualTo("ana@example.com");
    String payload = rows.get(0).getPayload();
    assertThat(rows.get(0).getTemplate()).isEqualTo("pelu_recordatorio_turno");
    assertThat(payload).contains("Ana").contains("Corte");
    assertThat(payload).contains("bella/turno/t" + a.getId());
  }

  @Test
  void secondRunNeverQueuesASecondReminder() {
    Appointment a = appointment(client(true, null), DAYTIME.plusSeconds(20 * 3600));
    run(a, DAYTIME);
    var again = run(a, DAYTIME);

    assertThat(again.outcome()).isEqualTo(WhatsAppReminderNotifier.Outcome.NOT_ELIGIBLE);
    assertThat(queued(a)).hasSize(1);
  }

  @Test
  void clientWithoutConsent_goesToTheEmailPath() {
    Appointment a = appointment(client(false, "x@example.com"), DAYTIME.plusSeconds(20 * 3600));
    var r = run(a, DAYTIME);
    assertThat(r.outcome()).isEqualTo(WhatsAppReminderNotifier.Outcome.NOT_ELIGIBLE);
    assertThat(r.reason()).isEqualTo("NO_CONSENT");
    assertThat(queued(a)).isEmpty();
    assertThat(reminderSentAt(a)).isNull();
  }

  @Test
  void optedOutPhone_goesToTheEmailPath() {
    Appointment a = appointment(client(true, "x@example.com"), DAYTIME.plusSeconds(20 * 3600));
    consent.optOut(phone, "TEST");
    var r = run(a, DAYTIME);
    assertThat(r.outcome()).isEqualTo(WhatsAppReminderNotifier.Outcome.NOT_ELIGIBLE);
    assertThat(r.reason()).isEqualTo("OPTED_OUT");
  }

  @Test
  void salonSwitchOff_goesToTheEmailPath() {
    settings.overrideReminders(tenant.getId(), false);
    Appointment a = appointment(client(true, "x@example.com"), DAYTIME.plusSeconds(20 * 3600));
    var r = run(a, DAYTIME);
    assertThat(r.reason()).isEqualTo("REMINDERS_DISABLED");
    assertThat(queued(a)).isEmpty();
  }

  @Test
  void noManageLink_goesToTheEmailPath() {
    links.setAvailable(false);
    Appointment a = appointment(client(true, "x@example.com"), DAYTIME.plusSeconds(20 * 3600));
    var r = run(a, DAYTIME);
    assertThat(r.reason()).isEqualTo("NO_LINK");
  }

  @Test
  void channelFlagOff_goesToTheEmailPath() {
    setFlag(WhatsAppAccess.FLAG, false);
    try {
      Appointment a = appointment(client(true, "x@example.com"), DAYTIME.plusSeconds(20 * 3600));
      assertThat(run(a, DAYTIME).reason()).isEqualTo("CHANNEL_UNAVAILABLE");
    } finally {
      setFlag(WhatsAppAccess.FLAG, true);
    }
  }

  @Test
  void quietHours_defersAFarTurnoWithoutMarkingIt_butSendsAnImminentOne() {
    Client c = client(true, null);
    Appointment far = appointment(c, NIGHT.plusSeconds(20 * 3600));
    var deferred = run(far, NIGHT);
    assertThat(deferred.outcome()).isEqualTo(WhatsAppReminderNotifier.Outcome.DEFERRED);
    assertThat(reminderSentAt(far)).isNull();
    assertThat(queued(far)).isEmpty();
    // the next hourly run after 08:00 finds it again and sends it
    assertThat(run(far, DAYTIME).outcome()).isEqualTo(WhatsAppReminderNotifier.Outcome.QUEUED);

    Appointment soon = appointment(c, NIGHT.plusSeconds(6 * 3600));
    assertThat(run(soon, NIGHT).outcome()).isEqualTo(WhatsAppReminderNotifier.Outcome.QUEUED);
  }

  @Test
  void jobRunsEmailPathForNonEligible_andWhatsAppForEligible_neverBoth() {
    Instant start = Instant.now().plusSeconds(2 * 86400);
    Appointment wa = appointment(client(true, "wa@example.com"), start);
    Appointment mail = appointment(client(false, "mail@example.com"), start.plusSeconds(3600));

    reminderService.sendDueReminders(start.minusSeconds(10 * 3600));

    assertThat(queued(wa)).hasSize(1);
    assertThat(queued(mail)).isEmpty();
    assertThat(reminderSentAt(wa)).isNotNull();
    assertThat(reminderSentAt(mail)).isNotNull();
  }
}
