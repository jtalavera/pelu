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
 * reschedule-resets-the-flag decision is exercised in {@code AppointmentServiceTest} instead, since
 * it's {@code AppointmentService#update} that resets it.
 *
 * <p>Issue #225 extends this with the independent WhatsApp channel: {@link WhatsAppService} is
 * mocked here the same way {@link EmailService} already is, and every new test below asserts that
 * one channel's success/failure/absence never affects the other's — same spirit as the pre-existing
 * per-appointment batch-isolation test.
 */
@ExtendWith(MockitoExtension.class)
class AppointmentReminderSchedulerTest {

  private static final String WHATSAPP_TEMPLATE = "appointment_reminder";

  @Mock private AppointmentRepository appointmentRepository;
  @Mock private AppointmentReminderPersistenceService persistenceService;
  @Mock private EmailService emailService;
  @Mock private WhatsAppService whatsAppService;

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
            whatsAppService,
            messageSource,
            new FemmeTimeProperties(),
            WHATSAPP_TEMPLATE);
  }

  private static Appointment appointmentStub(long id) {
    Appointment a = new Appointment();
    a.setId(id);
    return a;
  }

  private static ReminderContext contextFor(long tenantId, String email, String phone) {
    return new ReminderContext(
        tenantId, "Demo Salon", email, phone, "Maria Lopez", "Corte", "Ana Gomez", Instant.now());
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
        .thenReturn(contextFor(1L, "cliente@example.com", null));

    scheduler.sendDueReminders();

    verify(emailService).sendPlainTextEmail(eq("cliente@example.com"), anyString(), anyString());
    verify(persistenceService).markReminded(eq(1L), any(Instant.class));
    verify(whatsAppService, never()).sendTemplateMessage(any(), any(), any(), any());
    verify(persistenceService, never()).markWhatsAppReminded(anyLong(), any());
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
    verify(whatsAppService, never()).sendTemplateMessage(any(), any(), any(), any());
    verify(persistenceService, never()).markWhatsAppReminded(anyLong(), any());
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
        .thenReturn(contextFor(1L, "fails@example.com", null));
    when(persistenceService.resolveReminderContext(11L))
        .thenReturn(contextFor(1L, "ok@example.com", null));
    doThrow(new RuntimeException("ACS unreachable"))
        .when(emailService)
        .sendPlainTextEmail(eq("fails@example.com"), anyString(), anyString());

    assertThatCode(() -> scheduler.sendDueReminders()).doesNotThrowAnyException();

    verify(persistenceService, never()).markReminded(eq(10L), any());
    verify(emailService).sendPlainTextEmail(eq("ok@example.com"), anyString(), anyString());
    verify(persistenceService).markReminded(eq(11L), any(Instant.class));
  }

  // ---- Issue #225: WhatsApp channel, independent of email ----------------------------------

  @Test
  void sendDueReminders_clientWithPhoneOnly_sendsWhatsAppOnly() {
    when(appointmentRepository.findDueForReminder(any(), any(), any()))
        .thenReturn(List.of(appointmentStub(1L)));
    when(persistenceService.resolveReminderContext(1L))
        .thenReturn(contextFor(1L, null, "+595981123456"));

    scheduler.sendDueReminders();

    ArgumentCaptor<List<String>> paramsCaptor = ArgumentCaptor.forClass(List.class);
    verify(whatsAppService)
        .sendTemplateMessage(
            eq("+595981123456"), eq(WHATSAPP_TEMPLATE), eq("es"), paramsCaptor.capture());
    // {{1}} client first name, {{2}} salon name, {{3}} date, {{4}} time -- per the issue #225
    // proposed template text.
    assertThat(paramsCaptor.getValue()).hasSize(4);
    assertThat(paramsCaptor.getValue().get(0)).isEqualTo("Maria");
    assertThat(paramsCaptor.getValue().get(1)).isEqualTo("Demo Salon");
    verify(persistenceService).markWhatsAppReminded(eq(1L), any(Instant.class));
    verify(emailService, never()).sendPlainTextEmail(any(), any(), any());
    verify(persistenceService, never()).markReminded(anyLong(), any());
  }

  @Test
  void sendDueReminders_clientWithEmailOnly_sendsEmailOnly() {
    when(appointmentRepository.findDueForReminder(any(), any(), any()))
        .thenReturn(List.of(appointmentStub(1L)));
    when(persistenceService.resolveReminderContext(1L))
        .thenReturn(contextFor(1L, "cliente@example.com", null));

    scheduler.sendDueReminders();

    verify(emailService).sendPlainTextEmail(eq("cliente@example.com"), anyString(), anyString());
    verify(persistenceService).markReminded(eq(1L), any(Instant.class));
    verify(whatsAppService, never()).sendTemplateMessage(any(), any(), any(), any());
    verify(persistenceService, never()).markWhatsAppReminded(anyLong(), any());
  }

  @Test
  void sendDueReminders_clientWithBoth_sendsBothChannelsAndMarksBoth() {
    when(appointmentRepository.findDueForReminder(any(), any(), any()))
        .thenReturn(List.of(appointmentStub(1L)));
    when(persistenceService.resolveReminderContext(1L))
        .thenReturn(contextFor(1L, "cliente@example.com", "+595981123456"));

    scheduler.sendDueReminders();

    verify(emailService).sendPlainTextEmail(eq("cliente@example.com"), anyString(), anyString());
    verify(persistenceService).markReminded(eq(1L), any(Instant.class));
    verify(whatsAppService)
        .sendTemplateMessage(eq("+595981123456"), eq(WHATSAPP_TEMPLATE), eq("es"), any());
    verify(persistenceService).markWhatsAppReminded(eq(1L), any(Instant.class));
  }

  @Test
  void sendDueReminders_clientWithNeither_sendsNothing_noError() {
    when(appointmentRepository.findDueForReminder(any(), any(), any()))
        .thenReturn(List.of(appointmentStub(1L)));
    when(persistenceService.resolveReminderContext(1L)).thenReturn(contextFor(1L, null, null));

    assertThatCode(() -> scheduler.sendDueReminders()).doesNotThrowAnyException();

    verify(emailService, never()).sendPlainTextEmail(any(), any(), any());
    verify(whatsAppService, never()).sendTemplateMessage(any(), any(), any(), any());
    verify(persistenceService, never()).markReminded(anyLong(), any());
    verify(persistenceService, never()).markWhatsAppReminded(anyLong(), any());
  }

  /**
   * WhatsApp failing (invalid number, unapproved template, Meta API error) must not block email.
   */
  @Test
  void sendDueReminders_whatsAppSendFails_emailStillSentAndMarked() {
    when(appointmentRepository.findDueForReminder(any(), any(), any()))
        .thenReturn(List.of(appointmentStub(1L)));
    when(persistenceService.resolveReminderContext(1L))
        .thenReturn(contextFor(1L, "cliente@example.com", "+595981123456"));
    doThrow(new RuntimeException("Meta API error"))
        .when(whatsAppService)
        .sendTemplateMessage(eq("+595981123456"), anyString(), anyString(), any());

    assertThatCode(() -> scheduler.sendDueReminders()).doesNotThrowAnyException();

    verify(emailService).sendPlainTextEmail(eq("cliente@example.com"), anyString(), anyString());
    verify(persistenceService).markReminded(eq(1L), any(Instant.class));
    verify(persistenceService, never()).markWhatsAppReminded(anyLong(), any());
  }

  /** And the reverse: email failing must not block WhatsApp. */
  @Test
  void sendDueReminders_emailSendFails_whatsAppStillSentAndMarked() {
    when(appointmentRepository.findDueForReminder(any(), any(), any()))
        .thenReturn(List.of(appointmentStub(1L)));
    when(persistenceService.resolveReminderContext(1L))
        .thenReturn(contextFor(1L, "cliente@example.com", "+595981123456"));
    doThrow(new RuntimeException("ACS unreachable"))
        .when(emailService)
        .sendPlainTextEmail(eq("cliente@example.com"), anyString(), anyString());

    assertThatCode(() -> scheduler.sendDueReminders()).doesNotThrowAnyException();

    verify(whatsAppService)
        .sendTemplateMessage(eq("+595981123456"), anyString(), anyString(), any());
    verify(persistenceService).markWhatsAppReminded(eq(1L), any(Instant.class));
    verify(persistenceService, never()).markReminded(anyLong(), any());
  }

  /**
   * No double-send on a second run: once {@link AppointmentReminderPersistenceService} reports a
   * channel already sent (null target), the scheduler must not call that channel again — exercised
   * here by simulating the second run's context directly (the "already sent" guard itself is {@link
   * AppointmentReminderPersistenceServiceTest}'s job).
   */
  @Test
  void sendDueReminders_secondRunWithBothAlreadySent_sendsNeitherChannel() {
    when(appointmentRepository.findDueForReminder(any(), any(), any()))
        .thenReturn(List.of(appointmentStub(1L)));
    when(persistenceService.resolveReminderContext(1L)).thenReturn(contextFor(1L, null, null));

    scheduler.sendDueReminders();

    verify(emailService, never()).sendPlainTextEmail(any(), any(), any());
    verify(whatsAppService, never()).sendTemplateMessage(any(), any(), any(), any());
  }
}
