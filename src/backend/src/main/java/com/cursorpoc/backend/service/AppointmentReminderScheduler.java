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
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.MessageSource;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Issue #218: hourly job that emails clients a reminder ~24h ahead of their appointment. Issue #225
 * extends it to ALSO send a WhatsApp Business template message (via {@link WhatsAppService}, issue
 * #224's base integration) to the same client when they have a phone number on file — see the
 * "Issue #225" section below for how that channel is kept independent of email.
 *
 * <p><b>Time window</b>: on every run, picks up appointments whose {@code startAt} falls in {@code
 * [now + 23h, now + 25h)}. The job itself runs hourly ({@link #REMINDER_INTERVAL_MILLIS}), so an
 * appointment that hasn't aged out of the window yet is revisited on the next run too — that
 * 2h-wide window (1h of margin on each side of the nominal 24h mark) is slack for a slow or missed
 * tick, not something correctness depends on. Correctness (no duplicate sends) comes entirely from
 * {@code reminder_sent_at} / {@code whatsapp_reminder_sent_at}: {@link
 * AppointmentRepository#findDueForReminder} only returns appointments where at least one of the two
 * is still {@code null}, so a second visit inside the window is always a no-op for any channel
 * already sent. <b>Known gap</b>: this window/cadence combination only guarantees every appointment
 * is seen at least once if the app stays up continuously — if the process is down for more than ~2h
 * (a deploy, an outage), an appointment's window can close before any run ever queries it, and it
 * silently never gets a reminder. Accepted as-is for the single-Container-App deployment (no
 * distributed lock/backfill needed); revisit if that ever changes.
 *
 * <p><b>Reschedule handling</b>: {@code reminder_sent_at} / {@code whatsapp_reminder_sent_at} each
 * mean "a reminder was sent on THIS channel for THIS {@code startAt}", not "ever sent for this
 * appointment id". {@link AppointmentService#update} resets both to {@code null} whenever {@code
 * startAt} actually changes, so a rescheduled appointment is treated as needing a brand-new
 * reminder on both channels for its new time — the old reminder described a slot that no longer
 * exists, so re-sending for the new one is the correct behavior rather than a bug to guard against.
 * A cancelled appointment simply stops matching {@link #REMINDABLE_STATUSES} and is never
 * revisited.
 *
 * <p><b>Per-appointment transaction scoping</b>: the DB read (is this appointment still due?) and
 * the DB writes (mark it reminded, per channel) for a single appointment are each their own short
 * transaction, via {@link AppointmentReminderPersistenceService} — never the whole batch, and never
 * the two channels' writes lumped into one call. See that class's Javadoc: this is what makes a
 * crash/restart mid-run leave every channel already sent earlier in the same run durably marked,
 * instead of rolling everything back together with whichever send was in flight.
 *
 * <p><b>Issue #225 — independent channels</b>: for a single due appointment, the email and WhatsApp
 * sends are each attempted in their own {@code try/catch} ({@link #sendEmailReminder}, {@link
 * #sendWhatsAppReminder}) against the same {@link ReminderContext}, with their own success/failure
 * log line. Neither send, nor an exception from either, can affect the other: a client with phone
 * but no email only gets WhatsApp; a client with email but no phone only gets email; a WhatsApp
 * failure (invalid number, unapproved template, Meta API error) never blocks or rolls back the
 * email send, and vice versa. {@link ReminderContext#clientEmail()} / {@link
 * ReminderContext#clientPhone()} being {@code null} means "nothing to send on this channel" —
 * already-sent-for-this-slot and no-usable-contact-info are both resolved, and logged, per channel
 * inside {@link AppointmentReminderPersistenceService#resolveReminderContext}.
 *
 * <p><b>WhatsApp template</b>: {@link #whatsAppReminderTemplateName} (config: {@code
 * app.femme.whatsapp.appointment-reminder-template}) must be pre-created and approved in Meta
 * Business Manager before any real send can succeed — see the issue #225 PR description for the
 * exact proposed template text and current approval status. Until approved, {@link WhatsAppService}
 * either no-ops (dev/local, no real credentials) or every real send attempt fails and is logged as
 * an isolated per-appointment error, exactly like any other WhatsApp API failure — it does not
 * block the email channel.
 *
 * <p><b>e2e / disabled email</b>: gated by the same {@code app.femme.email.enabled} flag that
 * already governs every other outbound email in this app ({@code application-e2e.properties} sets
 * it to {@code false}) — when it's off, this bean isn't even registered, so the job never runs and
 * never polls the database under {@code e2e}. This also disables the WhatsApp channel under {@code
 * e2e} (on top of {@code app.femme.whatsapp.enabled=false} already making {@link WhatsAppService}
 * dev-log-only there) since #225 is an extension of this same scheduler, not a separate job.
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

  /**
   * Meta Cloud API template language code — the proposed {@code appointment_reminder} template (see
   * class Javadoc / PR description) is only ever submitted for approval in Spanish.
   */
  private static final String WHATSAPP_TEMPLATE_LANGUAGE = "es";

  private static final DateTimeFormatter DATE_FORMAT = DateTimeFormatter.ofPattern("dd/MM/yyyy");
  private static final DateTimeFormatter TIME_FORMAT = DateTimeFormatter.ofPattern("HH:mm");

  private final AppointmentRepository appointmentRepository;
  private final AppointmentReminderPersistenceService persistenceService;
  private final EmailService emailService;
  private final WhatsAppService whatsAppService;
  private final MessageSource messageSource;
  private final FemmeTimeProperties timeProperties;
  private final String whatsAppReminderTemplateName;

  public AppointmentReminderScheduler(
      AppointmentRepository appointmentRepository,
      AppointmentReminderPersistenceService persistenceService,
      EmailService emailService,
      WhatsAppService whatsAppService,
      MessageSource messageSource,
      FemmeTimeProperties timeProperties,
      @Value("${app.femme.whatsapp.appointment-reminder-template:appointment_reminder}")
          String whatsAppReminderTemplateName) {
    this.appointmentRepository = appointmentRepository;
    this.persistenceService = persistenceService;
    this.emailService = emailService;
    this.whatsAppService = whatsAppService;
    this.messageSource = messageSource;
    this.timeProperties = timeProperties;
    this.whatsAppReminderTemplateName = whatsAppReminderTemplateName;
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
      // Nothing to send on either channel — already logged (skip reason, per channel) by
      // resolveReminderContext, or the appointment no longer exists / has no client.
      return;
    }

    // Each channel is independent: one failing/throwing must never prevent or roll back the
    // other, so each gets its own try/catch and its own success/failure log line (issue #225 AC).
    if (context.clientEmail() != null) {
      sendEmailReminder(appointmentId, context);
    }
    if (context.clientPhone() != null) {
      sendWhatsAppReminder(appointmentId, context);
    }
  }

  private void sendEmailReminder(long appointmentId, ReminderContext context) {
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
          "Appointment email reminder sent tenantId={} appointmentId={} to={}",
          context.tenantId(),
          appointmentId,
          context.clientEmail());
    } catch (Exception ex) {
      log.error(
          "Appointment email reminder send failed tenantId={} appointmentId={}",
          context.tenantId(),
          appointmentId,
          ex);
    }
  }

  private void sendWhatsAppReminder(long appointmentId, ReminderContext context) {
    try {
      var localStartAt = context.startAt().atZone(timeProperties.zoneId());
      List<String> templateParams =
          List.of(
              firstName(context.clientName()),
              context.tenantName(),
              DATE_FORMAT.format(localStartAt),
              TIME_FORMAT.format(localStartAt));

      whatsAppService.sendTemplateMessage(
          context.clientPhone(),
          whatsAppReminderTemplateName,
          WHATSAPP_TEMPLATE_LANGUAGE,
          templateParams);
      persistenceService.markWhatsAppReminded(appointmentId, Instant.now());
      log.info(
          "Appointment WhatsApp reminder sent tenantId={} appointmentId={} to={}",
          context.tenantId(),
          appointmentId,
          context.clientPhone());
    } catch (Exception ex) {
      log.error(
          "Appointment WhatsApp reminder send failed tenantId={} appointmentId={}",
          context.tenantId(),
          appointmentId,
          ex);
    }
  }

  /**
   * First whitespace-separated token of the client's full name, for the WhatsApp template's {{1}}.
   */
  private static String firstName(String fullName) {
    if (fullName == null) {
      return null;
    }
    String trimmed = fullName.trim();
    int spaceIdx = trimmed.indexOf(' ');
    return spaceIdx == -1 ? trimmed : trimmed.substring(0, spaceIdx);
  }
}
