package com.cursorpoc.backend.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.cursorpoc.backend.domain.AppUser;
import com.cursorpoc.backend.domain.Appointment;
import com.cursorpoc.backend.domain.CashSession;
import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.domain.FiscalStamp;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.SalonService;
import com.cursorpoc.backend.domain.ServiceCategory;
import com.cursorpoc.backend.domain.ServiceRecord;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.Tier;
import com.cursorpoc.backend.domain.enums.AppointmentStatus;
import com.cursorpoc.backend.domain.enums.InvoiceStatus;
import com.cursorpoc.backend.domain.enums.ServiceRecordStatus;
import com.cursorpoc.backend.domain.enums.UserRole;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@link InvoiceRepository#findInvoiceIdsByAppointmentIds} against the real JPA mapping: the
 * agenda's "latest issued invoice of each turno" must keep the semantics of the former single OR
 * query now that it is two index-backed lookups merged in Java (staging load test, 2026-11-15).
 */
@SpringBootTest
@ActiveProfiles("test")
@Transactional
class InvoiceRepositoryFindInvoiceIdsByAppointmentIdsTest {

  @Autowired private TierRepository tierRepository;
  @Autowired private TenantRepository tenantRepository;
  @Autowired private AppUserRepository appUserRepository;
  @Autowired private FiscalStampRepository fiscalStampRepository;
  @Autowired private CashSessionRepository cashSessionRepository;
  @Autowired private ClientRepository clientRepository;
  @Autowired private ProfessionalRepository professionalRepository;
  @Autowired private ServiceCategoryRepository serviceCategoryRepository;
  @Autowired private SalonServiceRepository salonServiceRepository;
  @Autowired private AppointmentRepository appointmentRepository;
  @Autowired private ServiceRecordRepository serviceRecordRepository;
  @Autowired private InvoiceRepository invoiceRepository;

  private int nextNumber = 1;

  /** One tenant's catalog: everything an appointment and an invoice need. */
  private record World(
      Tenant tenant,
      FiscalStamp stamp,
      CashSession session,
      Client client,
      Professional professional,
      SalonService service) {}

  private World world;
  private World otherTenant;

  @BeforeEach
  void setUp() {
    world = newWorld();
    otherTenant = newWorld();
  }

  @Test
  void directLink_returnsLatestIssuedInvoiceOfTheTurno() {
    Appointment appt = appointment(world, null);
    Invoice older = invoice(world, appt, null, InvoiceStatus.ISSUED);
    Invoice newer = invoice(world, appt, null, InvoiceStatus.ISSUED);

    assertThat(latest(world, List.of(appt.getId())))
        .containsExactlyEntriesOf(Map.of(appt.getId(), newer.getId()));
    assertThat(newer.getId()).isGreaterThan(older.getId());
  }

  @Test
  void fichaLink_returnsTheFichaInvoiceForEveryTurnoItServes() {
    ServiceRecord ficha = serviceRecord(world);
    Appointment first = appointment(world, ficha);
    Appointment second = appointment(world, ficha);
    Invoice charged = invoice(world, null, ficha, InvoiceStatus.ISSUED);

    assertThat(latest(world, List.of(first.getId(), second.getId())))
        .containsExactlyInAnyOrderEntriesOf(
            Map.of(first.getId(), charged.getId(), second.getId(), charged.getId()));
  }

  @Test
  void bothLinks_returnTheHighestInvoiceIdAcrossThem() {
    ServiceRecord ficha = serviceRecord(world);
    Appointment appt = appointment(world, ficha);
    invoice(world, null, ficha, InvoiceStatus.ISSUED);
    Invoice direct = invoice(world, appt, null, InvoiceStatus.ISSUED);
    Invoice unrelated = invoice(world, null, null, InvoiceStatus.ISSUED);
    // a later invoice unrelated to the turno must not leak in
    assertThat(latest(world, List.of(appt.getId())))
        .containsExactlyEntriesOf(Map.of(appt.getId(), direct.getId()));
    assertThat(unrelated.getId()).isGreaterThan(direct.getId());
  }

  @Test
  void voidedInvoicesAndTurnosWithoutInvoice_areLeftOut() {
    Appointment voidedOnly = appointment(world, null);
    invoice(world, voidedOnly, null, InvoiceStatus.VOIDED);
    Appointment uninvoiced = appointment(world, null);

    assertThat(latest(world, List.of(voidedOnly.getId(), uninvoiced.getId()))).isEmpty();
  }

  @Test
  void otherTenantsTurnos_areNeverMatched() {
    Appointment foreign = appointment(otherTenant, null);
    invoice(otherTenant, foreign, null, InvoiceStatus.ISSUED);

    assertThat(latest(world, List.of(foreign.getId()))).isEmpty();
  }

  @Test
  void emptyIdList_returnsNothingWithoutQuerying() {
    assertThat(
            invoiceRepository.findInvoiceIdsByAppointmentIds(
                world.tenant().getId(), List.of(), InvoiceStatus.ISSUED))
        .isEmpty();
  }

  // ── helpers ─────────────────────────────────────────────────────────────────────────────────

  private Map<Long, Long> latest(World w, List<Long> appointmentIds) {
    invoiceRepository.flush();
    return invoiceRepository
        .findInvoiceIdsByAppointmentIds(w.tenant().getId(), appointmentIds, InvoiceStatus.ISSUED)
        .stream()
        .collect(Collectors.toMap(r -> (Long) r[0], r -> (Long) r[1]));
  }

  private World newWorld() {
    String n = String.valueOf(System.nanoTime());
    Tier tier = new Tier();
    tier.setName("Tier " + n);
    tier = tierRepository.save(tier);
    Tenant tenant = new Tenant();
    tenant.setName("Tenant " + n);
    tenant.setTier(tier);
    tenant = tenantRepository.save(tenant);

    AppUser user = new AppUser();
    user.setTenant(tenant);
    user.setEmail("agenda" + n + "@example.com");
    user.setPasswordHash("irrelevant-hash-value");
    user.setRole(UserRole.ADMIN);
    user.setEnabled(true);
    user = appUserRepository.save(user);

    FiscalStamp stamp = new FiscalStamp();
    stamp.setTenant(tenant);
    stamp.setStampNumber("ST-" + n);
    stamp.setValidFrom(LocalDate.of(2026, 1, 1));
    stamp.setRangeFrom(1);
    stamp.setNextEmissionNumber(1);
    stamp.setActive(true);
    stamp = fiscalStampRepository.save(stamp);

    CashSession session = new CashSession();
    session.setTenant(tenant);
    session.setOpenedByUser(user);
    session.setOpenedAt(Instant.now());
    session.setOpeningCashAmount(BigDecimal.ZERO);
    session = cashSessionRepository.save(session);

    Client client = new Client();
    client.setTenant(tenant);
    client.setFullName("Cliente " + n);
    client.setActive(true);
    client = clientRepository.save(client);

    Professional professional = new Professional();
    professional.setTenant(tenant);
    professional.setFullName("Profesional " + n);
    professional.setActive(true);
    professional = professionalRepository.save(professional);

    ServiceCategory category = new ServiceCategory();
    category.setTenant(tenant);
    category.setName("Cat " + n);
    category.setActive(true);
    category = serviceCategoryRepository.save(category);

    SalonService service = new SalonService();
    service.setTenant(tenant);
    service.setCategory(category);
    service.setName("Corte " + n);
    service.setPriceMinor(new BigDecimal("50000"));
    service.setDurationMinutes(30);
    service.setActive(true);
    service = salonServiceRepository.save(service);

    return new World(tenant, stamp, session, client, professional, service);
  }

  private ServiceRecord serviceRecord(World w) {
    ServiceRecord r = new ServiceRecord();
    r.setTenant(w.tenant());
    r.setClient(w.client());
    r.setStatus(ServiceRecordStatus.CLOSED);
    r.setTotalAmount(new BigDecimal("50000"));
    r.setCreatedAt(Instant.now());
    r.setClosedAt(Instant.now());
    return serviceRecordRepository.save(r);
  }

  private Appointment appointment(World w, ServiceRecord ficha) {
    Appointment a = new Appointment();
    a.setTenant(w.tenant());
    a.setClient(w.client());
    a.setProfessional(w.professional());
    a.setSalonService(w.service());
    Instant start = Instant.parse("2026-11-16T13:00:00Z").plusSeconds(3600L * nextNumber);
    a.setStartAt(start);
    a.setEndAt(start.plusSeconds(1800));
    a.setStatus(AppointmentStatus.COMPLETED);
    a.setServiceRecord(ficha);
    return appointmentRepository.save(a);
  }

  private Invoice invoice(World w, Appointment appt, ServiceRecord ficha, InvoiceStatus status) {
    Invoice invoice = new Invoice();
    invoice.setTenant(w.tenant());
    invoice.setFiscalStamp(w.stamp());
    invoice.setCashSession(w.session());
    invoice.setInvoiceNumber(nextNumber++);
    invoice.setStatus(status);
    invoice.setSubtotal(BigDecimal.TEN);
    invoice.setTotal(BigDecimal.TEN);
    invoice.setIssuedAt(Instant.now());
    invoice.setAppointment(appt);
    invoice.setServiceRecord(ficha);
    return invoiceRepository.save(invoice);
  }
}
