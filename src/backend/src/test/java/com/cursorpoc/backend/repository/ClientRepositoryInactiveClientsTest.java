package com.cursorpoc.backend.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.cursorpoc.backend.domain.Appointment;
import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.SalonService;
import com.cursorpoc.backend.domain.ServiceCategory;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.Tier;
import com.cursorpoc.backend.domain.enums.AppointmentStatus;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

/**
 * Issue #216 — "Panel de clientes inactivos". Runs the real JPQL in {@link
 * ClientRepository#findActiveClientsWithLastCompletedVisit} against the real JPA mapping + H2
 * schema (not a mock), proving what {@code DashboardServiceInactiveClientsTest}'s mocked repository
 * cannot: tenant scoping, the {@code LEFT JOIN}/{@code GROUP BY}/{@code MAX(startAt)} aggregation
 * itself, and that a non-{@code COMPLETED} appointment doesn't count as a visit.
 */
@SpringBootTest
@ActiveProfiles("test")
@Transactional
class ClientRepositoryInactiveClientsTest {

  @Autowired private TenantRepository tenantRepository;
  @Autowired private TierRepository tierRepository;
  @Autowired private ClientRepository clientRepository;
  @Autowired private ProfessionalRepository professionalRepository;
  @Autowired private ServiceCategoryRepository serviceCategoryRepository;
  @Autowired private SalonServiceRepository salonServiceRepository;
  @Autowired private AppointmentRepository appointmentRepository;

  private Tenant persistTenant(String name) {
    Tier tier = new Tier();
    tier.setName(name + " tier " + System.nanoTime());
    tier = tierRepository.save(tier);

    Tenant tenant = new Tenant();
    tenant.setName(name);
    tenant.setTier(tier);
    return tenantRepository.save(tenant);
  }

  private Professional persistProfessional(Tenant tenant, String name) {
    Professional professional = new Professional();
    professional.setTenant(tenant);
    professional.setFullName(name);
    professional.setActive(true);
    return professionalRepository.save(professional);
  }

  private SalonService persistService(Tenant tenant, String name) {
    ServiceCategory category = new ServiceCategory();
    category.setTenant(tenant);
    category.setName(name + " category");
    category.setActive(true);
    category = serviceCategoryRepository.save(category);

    SalonService service = new SalonService();
    service.setTenant(tenant);
    service.setCategory(category);
    service.setName(name);
    service.setPriceMinor(BigDecimal.valueOf(50_000));
    service.setDurationMinutes(60);
    service.setActive(true);
    return salonServiceRepository.save(service);
  }

  private Client persistClient(Tenant tenant, String fullName, boolean active) {
    Client client = new Client();
    client.setTenant(tenant);
    client.setFullName(fullName);
    client.setActive(active);
    return clientRepository.save(client);
  }

  private void persistAppointment(
      Tenant tenant,
      Professional professional,
      SalonService service,
      Client client,
      AppointmentStatus status,
      long daysAgo) {
    Instant startAt = Instant.now().minus(daysAgo, ChronoUnit.DAYS);
    Appointment appointment = new Appointment();
    appointment.setTenant(tenant);
    appointment.setProfessional(professional);
    appointment.setSalonService(service);
    appointment.setClient(client);
    appointment.setStartAt(startAt);
    appointment.setEndAt(startAt.plusSeconds(3600));
    appointment.setStatus(status);
    appointmentRepository.save(appointment);
  }

  @Test
  void tenantScoping_nonCompletedVisits_andActiveFilter_areAllHonoredByTheQuery() {
    Tenant tenant1 = persistTenant("Tenant One");
    Tenant tenant2 = persistTenant("Tenant Two");

    Professional prof1 = persistProfessional(tenant1, "Prof One");
    SalonService service1 = persistService(tenant1, "Service One");
    Professional prof2 = persistProfessional(tenant2, "Prof Two");
    SalonService service2 = persistService(tenant2, "Service Two");

    // (a) tenant scoping: same full name in another tenant must never leak into tenant1's result.
    Client sameNameOtherTenant = persistClient(tenant2, "Ana", true);
    persistAppointment(
        tenant2, prof2, service2, sameNameOtherTenant, AppointmentStatus.COMPLETED, 100);

    Client withCompletedVisit = persistClient(tenant1, "Ana", true);
    persistAppointment(
        tenant1, prof1, service1, withCompletedVisit, AppointmentStatus.COMPLETED, 100);

    // (b) only a non-COMPLETED appointment exists — must be treated as never-visited (null), not
    // as if the client had a recent visit.
    Client onlyPending = persistClient(tenant1, "Pending Only", true);
    persistAppointment(tenant1, prof1, service1, onlyPending, AppointmentStatus.PENDING, 1);

    Client neverAppointed = persistClient(tenant1, "Never Appointed", true);

    // (c) active=false must be excluded from the query result itself, even with an old completed
    // visit that would otherwise qualify as inactive.
    Client inactiveFlag = persistClient(tenant1, "Inactive Flag", false);
    persistAppointment(tenant1, prof1, service1, inactiveFlag, AppointmentStatus.COMPLETED, 200);

    List<ClientRepository.InactiveClientRow> rows =
        clientRepository.findActiveClientsWithLastCompletedVisit(
            tenant1.getId(), AppointmentStatus.COMPLETED);

    assertThat(rows)
        .extracting(ClientRepository.InactiveClientRow::getClientId)
        .containsExactlyInAnyOrder(
            withCompletedVisit.getId(), onlyPending.getId(), neverAppointed.getId());
    assertThat(rows)
        .extracting(ClientRepository.InactiveClientRow::getClientId)
        .doesNotContain(inactiveFlag.getId(), sameNameOtherTenant.getId());

    ClientRepository.InactiveClientRow completedRow =
        rows.stream()
            .filter(r -> r.getClientId().equals(withCompletedVisit.getId()))
            .findFirst()
            .orElseThrow();
    assertThat(completedRow.getLastCompletedVisit()).isNotNull();

    ClientRepository.InactiveClientRow pendingOnlyRow =
        rows.stream()
            .filter(r -> r.getClientId().equals(onlyPending.getId()))
            .findFirst()
            .orElseThrow();
    assertThat(pendingOnlyRow.getLastCompletedVisit())
        .as("a PENDING (non-COMPLETED) appointment must not count as a visit")
        .isNull();

    ClientRepository.InactiveClientRow neverRow =
        rows.stream()
            .filter(r -> r.getClientId().equals(neverAppointed.getId()))
            .findFirst()
            .orElseThrow();
    assertThat(neverRow.getLastCompletedVisit()).isNull();
  }
}
