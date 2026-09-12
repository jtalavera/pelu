package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.domain.Appointment;
import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.SalonService;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.AppointmentStatus;
import com.cursorpoc.backend.repository.AppointmentRepository;
import com.cursorpoc.backend.service.AppointmentReminderPersistenceService.ReminderContext;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/**
 * Issue #218 code review follow-up: the no-more-than-one-reminder and no-client-email guards moved
 * here from {@code AppointmentReminderScheduler} when the per-appointment DB work was split into
 * its own short-lived transaction (see the class Javadoc) — this is now where those acceptance
 * criteria are actually exercised.
 */
@ExtendWith(MockitoExtension.class)
class AppointmentReminderPersistenceServiceTest {

  @Mock private AppointmentRepository appointmentRepository;

  private AppointmentReminderPersistenceService service;

  private Tenant tenant;
  private Professional professional;
  private SalonService salonService;

  @BeforeEach
  void setUp() {
    service = new AppointmentReminderPersistenceService(appointmentRepository);

    tenant = new Tenant();
    tenant.setId(1L);
    tenant.setName("Demo Salon");

    professional = new Professional();
    professional.setId(10L);
    professional.setFullName("Ana Gomez");

    salonService = new SalonService();
    salonService.setId(20L);
    salonService.setName("Corte");
  }

  private Appointment buildAppointment(long id, Client client) {
    Appointment a = new Appointment();
    a.setId(id);
    a.setTenant(tenant);
    a.setProfessional(professional);
    a.setSalonService(salonService);
    a.setClient(client);
    a.setStartAt(Instant.now().plus(Duration.ofHours(24)));
    a.setEndAt(Instant.now().plus(Duration.ofHours(25)));
    a.setStatus(AppointmentStatus.CONFIRMED);
    return a;
  }

  private static Client clientWithEmail(String email) {
    Client c = new Client();
    c.setId(30L);
    c.setFullName("Maria Lopez");
    c.setEmail(email);
    return c;
  }

  @Test
  void resolveReminderContext_returnsEveryFieldNeededToBuildTheEmail() {
    Appointment appointment = buildAppointment(1L, clientWithEmail("cliente@example.com"));
    when(appointmentRepository.findById(1L)).thenReturn(Optional.of(appointment));

    ReminderContext context = service.resolveReminderContext(1L);

    assertThat(context).isNotNull();
    assertThat(context.tenantId()).isEqualTo(1L);
    assertThat(context.tenantName()).isEqualTo("Demo Salon");
    assertThat(context.clientEmail()).isEqualTo("cliente@example.com");
    assertThat(context.clientName()).isEqualTo("Maria Lopez");
    assertThat(context.serviceName()).isEqualTo("Corte");
    assertThat(context.professionalName()).isEqualTo("Ana Gomez");
    assertThat(context.startAt()).isEqualTo(appointment.getStartAt());
  }

  @Test
  void resolveReminderContext_trimsClientEmail() {
    Appointment appointment = buildAppointment(1L, clientWithEmail("  cliente@example.com  "));
    when(appointmentRepository.findById(1L)).thenReturn(Optional.of(appointment));

    ReminderContext context = service.resolveReminderContext(1L);

    assertThat(context.clientEmail()).isEqualTo("cliente@example.com");
  }

  @Test
  void resolveReminderContext_appointmentNotFound_returnsNull() {
    when(appointmentRepository.findById(99L)).thenReturn(Optional.empty());

    assertThat(service.resolveReminderContext(99L)).isNull();
  }

  @Test
  void resolveReminderContext_alreadyReminded_returnsNull() {
    Appointment appointment = buildAppointment(1L, clientWithEmail("cliente@example.com"));
    appointment.setReminderSentAt(Instant.now().minus(Duration.ofMinutes(10)));
    when(appointmentRepository.findById(1L)).thenReturn(Optional.of(appointment));

    assertThat(service.resolveReminderContext(1L)).isNull();
  }

  @Test
  void resolveReminderContext_noClient_returnsNull() {
    Appointment appointment = buildAppointment(1L, null);
    when(appointmentRepository.findById(1L)).thenReturn(Optional.of(appointment));

    assertThat(service.resolveReminderContext(1L)).isNull();
  }

  @Test
  void resolveReminderContext_clientWithoutEmail_returnsNull() {
    Appointment appointment = buildAppointment(1L, clientWithEmail(null));
    when(appointmentRepository.findById(1L)).thenReturn(Optional.of(appointment));

    assertThat(service.resolveReminderContext(1L)).isNull();
  }

  @Test
  void resolveReminderContext_blankClientEmail_returnsNull() {
    Appointment appointment = buildAppointment(1L, clientWithEmail("   "));
    when(appointmentRepository.findById(1L)).thenReturn(Optional.of(appointment));

    assertThat(service.resolveReminderContext(1L)).isNull();
  }

  @Test
  void markReminded_setsReminderSentAt_andSavesNothingElse() {
    Appointment appointment = buildAppointment(1L, clientWithEmail("cliente@example.com"));
    when(appointmentRepository.findById(1L)).thenReturn(Optional.of(appointment));
    Instant sentAt = Instant.now();

    service.markReminded(1L, sentAt);

    assertThat(appointment.getReminderSentAt()).isEqualTo(sentAt);
  }

  @Test
  void markReminded_appointmentNotFound_doesNothing() {
    when(appointmentRepository.findById(99L)).thenReturn(Optional.empty());

    assertThatCode(() -> service.markReminded(99L, Instant.now())).doesNotThrowAnyException();
  }
}
