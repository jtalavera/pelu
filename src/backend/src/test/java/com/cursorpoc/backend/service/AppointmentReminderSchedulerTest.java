package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.Appointment;
import com.cursorpoc.backend.domain.enums.AppointmentStatus;
import com.cursorpoc.backend.repository.AppointmentRepository;
import com.cursorpoc.backend.service.AppointmentReminderPersistenceService.ReminderContext;
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
 * something Playwright can trigger, so this is the acceptance-criteria coverage for the time window
 * and failure isolation across a batch. {@link AppointmentReminderPersistenceService}'s own test
 * covers the no-duplicate-sends and client-without-email skip logic, since code review moved that
 * guard logic there (per-appointment transaction scoping — see that class's Javadoc); the
 * reschedule-resets-the-flag decision is exercised in {@link AppointmentServiceTest} instead, since
 * it's {@code AppointmentService#update} that resets it.
 */
@ExtendWith(MockitoExtension.class)
class AppointmentReminderSchedulerTest {

  @Mock private AppointmentRepository appointmentRepository;
  @Mock private AppointmentReminderPersistenceService persistenceService;
  @Mock private EmailService emailService;

  private MessageSource messageSource;
  private AppointmentReminderScheduler scheduler;

  @BeforeEach
  void setUp() {
    messageSource = mock(MessageSource.class);
    lenient()
        .when(messageSource.getMessage(anyString(), any(), any(Locale.class)))
        .thenReturn("text");
    scheduler =
        new AppointmentReminderScheduler(
            appointmentRepository,
            persistenceService,
            emailService,
            messageSource,
            new FemmeTimeProperties());
  }

  private static Appointment appointmentStub(long id) {
    Appointment a = new Appointment();
    a.setId(id);
    return a;
  }

  private static ReminderContext contextFor(long tenantId, String email) {
    return new ReminderContext(
        tenantId, "Demo Salon", email, "Maria Lopez", "Corte", "Ana Gomez", Instant.now());
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
    when(appointmentRepository.findDueForReminder(any(), any(), any()))
        .thenReturn(List.of(appointmentStub(1L)));
    when(persistenceService.resolveReminderContext(1L))
        .thenReturn(contextFor(1L, "cliente@example.com"));

    scheduler.sendDueReminders();

    verify(emailService).sendPlainTextEmail(eq("cliente@example.com"), anyString(), anyString());
    verify(persistenceService).markReminded(eq(1L), any(Instant.class));
  }

  /**
   * {@link AppointmentReminderPersistenceService#resolveReminderContext} is what encodes "skip,
   * already reminded" / "skip, no client email" (see its own test) — from the scheduler's point of
   * view both collapse to the same signal: a {@code null} context means nothing to send.
   */
  @Test
  void sendDueReminders_nullContext_skipsWithoutSendingOrThrowing() {
    when(appointmentRepository.findDueForReminder(any(), any(), any()))
        .thenReturn(List.of(appointmentStub(2L)));
    when(persistenceService.resolveReminderContext(2L)).thenReturn(null);

    assertThatCode(() -> scheduler.sendDueReminders()).doesNotThrowAnyException();

    verify(emailService, never()).sendPlainTextEmail(any(), any(), any());
    verify(persistenceService, never()).markReminded(anyLong(), any());
  }

  /**
   * Code review follow-up: a send failure for one appointment must not propagate out of the batch,
   * must not mark that appointment reminded, and must not stop a later appointment in the same run
   * from being processed and marked — proving the per-appointment transaction scoping in {@link
   * AppointmentReminderPersistenceService} actually isolates each appointment's outcome.
   */
  @Test
  void sendDueReminders_emailSendFailure_isIsolatedPerAppointment_andDoesNotStopTheBatch() {
    when(appointmentRepository.findDueForReminder(any(), any(), any()))
        .thenReturn(List.of(appointmentStub(10L), appointmentStub(11L)));
    when(persistenceService.resolveReminderContext(10L))
        .thenReturn(contextFor(1L, "fails@example.com"));
    when(persistenceService.resolveReminderContext(11L))
        .thenReturn(contextFor(1L, "ok@example.com"));
    doThrow(new RuntimeException("ACS unreachable"))
        .when(emailService)
        .sendPlainTextEmail(eq("fails@example.com"), anyString(), anyString());

    assertThatCode(() -> scheduler.sendDueReminders()).doesNotThrowAnyException();

    verify(persistenceService, never()).markReminded(eq(10L), any());
    verify(emailService).sendPlainTextEmail(eq("ok@example.com"), anyString(), anyString());
    verify(persistenceService).markReminded(eq(11L), any(Instant.class));
  }
}
