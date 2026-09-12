package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.Appointment;
import com.cursorpoc.backend.domain.enums.AppointmentStatus;
import com.cursorpoc.backend.repository.AppointmentRepository;
import com.cursorpoc.backend.service.AppointmentReminderPersistenceService.ReminderContext;
import java.time.Duration;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.MessageSource;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Issue #218: hourly job that emails clients a reminder ~24h ahead of their appointment.
 *
 * <p><b>Time window</b>: on every run, picks up appointments whose {@code startAt} falls in {@code
 * [now + 23h, now + 25h)}. The job itself runs hourly ({@link #REMINDER_INTERVAL_MILLIS}), so an
 * appointment that hasn't aged out of the window yet is revisited on the next run too — that
 * 2h-wide window (1h of margin on each side of the nominal 24h mark) is slack for a slow or missed
 * tick, not something correctness depends on. Correctness (no duplicate sends) comes entirely from
 * {@code reminder_sent_at}: {@link AppointmentRepository#findDueForReminder} only returns
 * appointments where it's still {@code null}, so a second visit inside the window is always a no-op
 * for anything already sent. <b>Known gap</b>: this window/cadence combination only guarantees
 * every appointment is seen at least once if the app stays up continuously — if the process is down
 * for more than ~2h (a deploy, an outage), an appointment's window can close before any run ever
 * queries it, and it silently never gets a reminder. Accepted as-is for the single-Container-App
 * deployment (no distributed lock/backfill needed); revisit if that ever changes.
 *
 * <p><b>Reschedule handling</b>: {@code reminder_sent_at} means "a reminder was sent for THIS
 * {@code startAt}", not "ever sent for this appointment id". {@link AppointmentService#update}
 * resets it to {@code null} whenever {@code startAt} actually changes, so a rescheduled appointment
 * is treated as needing a brand-new reminder for its new time — the old reminder described a slot
 * that no longer exists, so re-sending for the new one is the correct behavior rather than a bug to
 * guard against. A cancelled appointment simply stops matching {@link #REMINDABLE_STATUSES} and is
 * never revisited.
 *
 * <p><b>Per-appointment transaction scoping</b>: the DB read (is this appointment still due?) and
 * the DB write (mark it reminded) for a single appointment are each their own short transaction,
 * via {@link AppointmentReminderPersistenceService} — never the whole batch. See that class's
 * Javadoc: this is what makes a crash/restart mid-run leave every appointment already reminded
 * earlier in the same run durably marked, instead of rolling all of them back together with
 * whichever appointment was in flight.
 *
 * <p><b>e2e / disabled email</b>: gated by the same {@code app.femme.email.enabled} flag that
 * already governs every other outbound email in this app ({@code application-e2e.properties} sets
 * it to {@code false}) — when it's off, this bean isn't even registered, so the job never runs and
 * never polls the database under {@code e2e}.
 */
@Component
@ConditionalOnProperty(
    name = "app.femme.email.enabled",
    havingValue = "true",
    matchIfMissing = true)
public class AppointmentReminderScheduler {

  private static final Logger log = LoggerFactory.getLogger(AppointmentReminderScheduler.class);

  static final long REMINDER_INTERVAL_MILLIS = 60L * 60 * 1000; // hourly

  /** Appointments become due once they're at least this far ahead of "now". */
  static final Duration WINDOW_START_AHEAD = Duration.ofHours(23);

  /** Appointments stop being due once they're this far ahead of "now" (exclusive). */
  static final Duration WINDOW_END_AHEAD = Duration.ofHours(25);

  private static final List<AppointmentStatus> REMINDABLE_STATUSES =
      List.of(AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED);

  /** Appointment reminders are always sent in Spanish, same as the other SIFEN client emails. */
  private static final Locale REMINDER_LOCALE = Locale.forLanguageTag("es-PY");

  private static final DateTimeFormatter DATE_FORMAT = DateTimeFormatter.ofPattern("dd/MM/yyyy");
  private static final DateTimeFormatter TIME_FORMAT = DateTimeFormatter.ofPattern("HH:mm");

  private final AppointmentRepository appointmentRepository;
  private final AppointmentReminderPersistenceService persistenceService;
  private final EmailService emailService;
  private final MessageSource messageSource;
  private final FemmeTimeProperties timeProperties;

  public AppointmentReminderScheduler(
      AppointmentRepository appointmentRepository,
      AppointmentReminderPersistenceService persistenceService,
      EmailService emailService,
      MessageSource messageSource,
      FemmeTimeProperties timeProperties) {
    this.appointmentRepository = appointmentRepository;
    this.persistenceService = persistenceService;
    this.emailService = emailService;
    this.messageSource = messageSource;
    this.timeProperties = timeProperties;
  }

  @Scheduled(fixedDelay = REMINDER_INTERVAL_MILLIS)
  public void sendDueReminders() {
    Instant now = Instant.now();
    Instant windowStart = now.plus(WINDOW_START_AHEAD);
    Instant windowEnd = now.plus(WINDOW_END_AHEAD);

    List<Long> dueAppointmentIds =
        appointmentRepository
            .findDueForReminder(REMINDABLE_STATUSES, windowStart, windowEnd)
            .stream()
            .map(Appointment::getId)
            .toList();

    for (Long appointmentId : dueAppointmentIds) {
      sendReminder(appointmentId);
    }
  }

  private void sendReminder(long appointmentId) {
    ReminderContext context = persistenceService.resolveReminderContext(appointmentId);
    if (context == null) {
      // Nothing to send — already logged (skip reason) by resolveReminderContext, or the
      // appointment no longer exists.
      return;
    }

    try {
      var localStartAt = context.startAt().atZone(timeProperties.zoneId());
      String subject =
          messageSource.getMessage(
              "email.appointmentReminder.subject",
              new Object[] {context.tenantName()},
              REMINDER_LOCALE);
      String body =
          messageSource.getMessage(
              "email.appointmentReminder.body",
              new Object[] {
                context.clientName(),
                context.tenantName(),
                DATE_FORMAT.format(localStartAt),
                TIME_FORMAT.format(localStartAt),
                context.serviceName(),
                context.professionalName()
              },
              REMINDER_LOCALE);

      emailService.sendPlainTextEmail(context.clientEmail(), subject, body);
      persistenceService.markReminded(appointmentId, Instant.now());
      log.info(
          "Appointment reminder sent tenantId={} appointmentId={} to={}",
          context.tenantId(),
          appointmentId,
          context.clientEmail());
    } catch (Exception ex) {
      log.error(
          "Appointment reminder send failed tenantId={} appointmentId={}",
          context.tenantId(),
          appointmentId,
          ex);
    }
  }
}
