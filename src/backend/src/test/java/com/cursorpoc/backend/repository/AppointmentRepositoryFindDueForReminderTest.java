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
 * Issue #218 follow-up: runs the real JPQL in {@link AppointmentRepository#findDueForReminder}
 * against the real JPA mapping + H2 schema, proving what {@code AppointmentReminderSchedulerTest}'s
 * mocked repository cannot — in particular that there's deliberately no lower bound, so a same-day
 * booking (or one a downtime window caused to be missed) still matches as long as it hasn't started
 * yet, while an already-started or already-reminded appointment does not.
 */
@SpringBootTest
@ActiveProfiles("test")
@Transactional
class AppointmentRepositoryFindDueForReminderTest {

  @Autowired private TenantRepository tenantRepository;
  @Autowired private TierRepository tierRepository;
  @Autowired private ClientRepository clientRepository;
  @Autowired private ProfessionalRepository professionalRepository;
  @Autowired private ServiceCategoryRepository serviceCategoryRepository;
  @Autowired private SalonServiceRepository salonServiceRepository;
  @Autowired private AppointmentRepository appointmentRepository;

  private static final List<AppointmentStatus> REMINDABLE_STATUSES =
      List.of(AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED);

  private Tenant persistTenant() {
    Tier tier = new Tier();
    tier.setName("Tier " + System.nanoTime());
    tier = tierRepository.save(tier);
    Tenant tenant = new Tenant();
    tenant.setName("Tenant " + System.nanoTime());
    tenant.setTier(tier);
    return tenantRepository.save(tenant);
  }

  private Professional persistProfessional(Tenant tenant) {
    Professional professional = new Professional();
    professional.setTenant(tenant);
    professional.setFullName("Prof " + System.nanoTime());
    professional.setActive(true);
    return professionalRepository.save(professional);
  }

  private SalonService persistService(Tenant tenant) {
    ServiceCategory category = new ServiceCategory();
    category.setTenant(tenant);
    category.setName("Category " + System.nanoTime());
    category.setActive(true);
    category = serviceCategoryRepository.save(category);

    SalonService service = new SalonService();
    service.setTenant(tenant);
    service.setCategory(category);
    service.setName("Service " + System.nanoTime());
    service.setPriceMinor(BigDecimal.valueOf(50_000));
    service.setDurationMinutes(60);
    service.setActive(true);
    return salonServiceRepository.save(service);
  }

  private Client persistClient(Tenant tenant) {
    Client client = new Client();
    client.setTenant(tenant);
    client.setFullName("Client " + System.nanoTime());
    client.setActive(true);
    client.setEmail("client" + System.nanoTime() + "@example.com");
    return clientRepository.save(client);
  }

  private Appointment persistAppointment(
      Tenant tenant,
      Professional professional,
      SalonService service,
      Client client,
      AppointmentStatus status,
      Instant startAt,
      Instant reminderSentAt) {
    Appointment appointment = new Appointment();
    appointment.setTenant(tenant);
    appointment.setProfessional(professional);
    appointment.setSalonService(service);
    appointment.setClient(client);
    appointment.setStartAt(startAt);
    appointment.setEndAt(startAt.plusSeconds(3600));
    appointment.setStatus(status);
    appointment.setReminderSentAt(reminderSentAt);
    return appointmentRepository.save(appointment);
  }

  @Test
  void matchesSameDayAndDowntimeMissedAppointments_butNotStartedOrAlreadyRemindedOnes() {
    Tenant tenant = persistTenant();
    Professional professional = persistProfessional(tenant);
    SalonService service = persistService(tenant);
    Instant now = Instant.now();

    // (a) same-day / last-minute booking — only 2h out, well under the old 23h floor.
    Appointment sameDay =
        persistAppointment(
            tenant,
            professional,
            service,
            persistClient(tenant),
            AppointmentStatus.PENDING,
            now.plus(2, ChronoUnit.HOURS),
            null);

    // (b) a normal advance booking sitting in the nominal ~24h zone.
    Appointment nominal =
        persistAppointment(
            tenant,
            professional,
            service,
            persistClient(tenant),
            AppointmentStatus.CONFIRMED,
            now.plus(24, ChronoUnit.HOURS),
            null);

    // (c) "downtime sweep": due long ago (would have been missed while the process was down) but
    // still hasn't started — must still be picked up now rather than silently skipped forever.
    Appointment missedByDowntime =
        persistAppointment(
            tenant,
            professional,
            service,
            persistClient(tenant),
            AppointmentStatus.PENDING,
            now.plus(10, ChronoUnit.MINUTES),
            null);

    // (d) already started — must be excluded even though never reminded.
    persistAppointment(
        tenant,
        professional,
        service,
        persistClient(tenant),
        AppointmentStatus.CONFIRMED,
        now.minus(5, ChronoUnit.MINUTES),
        null);

    // (e) already reminded — must be excluded even though inside the window.
    persistAppointment(
        tenant,
        professional,
        service,
        persistClient(tenant),
        AppointmentStatus.PENDING,
        now.plus(3, ChronoUnit.HOURS),
        now.minus(1, ChronoUnit.HOURS));

    // (f) too far out — beyond the 25h ceiling, not due on this run.
    persistAppointment(
        tenant,
        professional,
        service,
        persistClient(tenant),
        AppointmentStatus.PENDING,
        now.plus(48, ChronoUnit.HOURS),
        null);

    // (g) cancelled — never remindable regardless of timing.
    persistAppointment(
        tenant,
        professional,
        service,
        persistClient(tenant),
        AppointmentStatus.CANCELLED,
        now.plus(4, ChronoUnit.HOURS),
        null);

    List<Appointment> due =
        appointmentRepository.findDueForReminder(
            REMINDABLE_STATUSES, now, now.plus(25, ChronoUnit.HOURS));

    assertThat(due)
        .extracting(Appointment::getId)
        .containsExactlyInAnyOrder(sameDay.getId(), nominal.getId(), missedByDowntime.getId());
  }
}
