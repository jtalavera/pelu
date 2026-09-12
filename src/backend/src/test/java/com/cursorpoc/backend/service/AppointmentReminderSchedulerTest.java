package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.Appointment;
import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.SalonService;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.AppointmentStatus;
import com.cursorpoc.backend.repository.AppointmentRepository;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.MessageSource;

/**
 * Issue #218: unit coverage for the ~24h-ahead appointment reminder job — scheduler behavior isn't
 * something Playwright can trigger (see the PR description), so this is the acceptance-criteria
 * coverage for the time window, no-duplicate-sends, client-without-email skip, and the
 * reschedule-resets-the-flag decision (that last one is exercised in {@link AppointmentServiceTest}
 * instead, since it's {@code AppointmentService#update} that resets it).
 */
@ExtendWith(MockitoExtension.class)
class AppointmentReminderSchedulerTest {

  @Mock private AppointmentRepository appointmentRepository;
  @Mock private EmailService emailService;

  private MessageSource messageSource;
  private AppointmentReminderScheduler scheduler;

  private Tenant tenant;
  private Professional professional;
  private SalonService salonService;

  @BeforeEach
  void setUp() {
    messageSource = mock(MessageSource.class);
    lenient()
        .when(messageSource.getMessage(anyString(), any(), any(Locale.class)))
        .thenReturn("text");
    scheduler =
        new AppointmentReminderScheduler(
            appointmentRepository, emailService, messageSource, new FemmeTimeProperties());

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

  private Appointment buildAppointment(long id, AppointmentStatus status, Client client) {
    Appointment a = new Appointment();
    a.setId(id);
    a.setTenant(tenant);
    a.setProfessional(professional);
    a.setSalonService(salonService);
    a.setClient(client);
    a.setStartAt(Instant.now().plus(Duration.ofHours(24)));
    a.setEndAt(Instant.now().plus(Duration.ofHours(25)));
    a.setStatus(status);
    return a;
  }

  private Client clientWithEmail(String email) {
    Client c = new Client();
    c.setId(30L);
    c.setFullName("Maria Lopez");
    c.setEmail(email);
    return c;
  }

  @Test
  void sendDueReminders_queriesTheCorrectTimeWindow() {
    when(appointmentRepository.findDueForReminder(any(), any(), any())).thenReturn(List.of());

    Instant before = Instant.now();
    scheduler.sendDueReminders();
    Instant after = Instant.now();

    ArgumentCaptor<Instant> fromCaptor = ArgumentCaptor.forClass(Instant.class);
    ArgumentCaptor<Instant> toCaptor = ArgumentCaptor.forClass(Instant.class);
    verify(appointmentRepository)
        .findDueForReminder(
            eq(List.of(AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED)),
            fromCaptor.capture(),
            toCaptor.capture());

    Instant from = fromCaptor.getValue();
    Instant to = toCaptor.getValue();

    // from ~= now + 23h, to ~= now + 25h, computed at call time.
    assertThat(from).isBetween(before.plus(Duration.ofHours(23)), after.plus(Duration.ofHours(23)));
    assertThat(to).isBetween(before.plus(Duration.ofHours(25)), after.plus(Duration.ofHours(25)));
    assertThat(Duration.between(from, to)).isEqualTo(Duration.ofHours(2));
  }

  @Test
  void sendDueReminders_sendsReminder_andMarksAppointmentAsReminded() {
    Client client = clientWithEmail("cliente@example.com");
    Appointment appointment = buildAppointment(1L, AppointmentStatus.CONFIRMED, client);
    when(appointmentRepository.findDueForReminder(any(), any(), any()))
        .thenReturn(List.of(appointment));

    scheduler.sendDueReminders();

    verify(emailService).sendPlainTextEmail(eq("cliente@example.com"), anyString(), anyString());
    assertThat(appointment.getReminderSentAt()).isNotNull();
    verify(appointmentRepository).save(appointment);
  }

  @Test
  void sendDueReminders_clientWithoutEmail_skipsWithoutSendingOrThrowing() {
    Client client = clientWithEmail(null);
    Appointment appointment = buildAppointment(2L, AppointmentStatus.PENDING, client);
    when(appointmentRepository.findDueForReminder(any(), any(), any()))
        .thenReturn(List.of(appointment));

    scheduler.sendDueReminders();

    verify(emailService, never()).sendPlainTextEmail(any(), any(), any());
    assertThat(appointment.getReminderSentAt()).isNull();
    verify(appointmentRepository, never()).save(any());
  }

  @Test
  void sendDueReminders_appointmentWithNoClient_skipsWithoutSendingOrThrowing() {
    Appointment appointment = buildAppointment(3L, AppointmentStatus.PENDING, null);
    when(appointmentRepository.findDueForReminder(any(), any(), any()))
        .thenReturn(List.of(appointment));

    scheduler.sendDueReminders();

    verify(emailService, never()).sendPlainTextEmail(any(), any(), any());
    assertThat(appointment.getReminderSentAt()).isNull();
  }

  @Test
  void sendDueReminders_blankClientEmail_skipsWithoutSendingOrThrowing() {
    Client client = clientWithEmail("   ");
    Appointment appointment = buildAppointment(4L, AppointmentStatus.PENDING, client);
    when(appointmentRepository.findDueForReminder(any(), any(), any()))
        .thenReturn(List.of(appointment));

    scheduler.sendDueReminders();

    verify(emailService, never()).sendPlainTextEmail(any(), any(), any());
  }

  /**
   * No more than one reminder per appointment: {@code findDueForReminder} filters on {@code
   * reminderSentAt IS NULL} at the query level, but the scheduler also re-checks it in memory
   * (belt-and-suspenders — see {@code sendReminder}) so the invariant holds even if a future caller
   * feeds it an appointment fetched a different way. This test forces that second guard by having
   * the (mocked) repository return an appointment that's already marked reminded — a real query
   * would have excluded it, but if the guard here didn't exist, a stale/duplicate row reaching this
   * method would incorrectly send a second email.
   */
  @Test
  void sendDueReminders_doesNotResend_whenAlreadyMarkedReminded() {
    Client client = clientWithEmail("cliente@example.com");
    Appointment appointment = buildAppointment(5L, AppointmentStatus.CONFIRMED, client);
    appointment.setReminderSentAt(Instant.now().minus(Duration.ofMinutes(30)));
    when(appointmentRepository.findDueForReminder(any(), any(), any()))
        .thenReturn(List.of(appointment));

    scheduler.sendDueReminders();

    verify(emailService, never()).sendPlainTextEmail(any(), any(), any());
    verify(appointmentRepository, never()).save(any());
  }
}
