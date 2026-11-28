package com.cursorpoc.backend.whatsapp;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.Appointment;
import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.repository.AppointmentRepository;
import com.cursorpoc.backend.util.PhoneNumberNormalizer;
import java.time.Instant;
import java.time.ZoneId;
import java.util.List;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * HU-WAP-05: decides whether the reminder of a turno goes over WhatsApp and, if so, queues it.
 * Called by the hourly reminder job for every due turno BEFORE the email path.
 *
 * <p>WhatsApp is chosen only if ALL of these hold; otherwise the answer is {@code NOT_ELIGIBLE} and
 * the job sends the email exactly as it always did (never both, decision D11):
 *
 * <ul>
 *   <li>the salon turned on «Recordatorios de turnos» and the channel is available for it;
 *   <li>the client has a valid consent for her valid phone, which is not opted out nor unreachable;
 *   <li>there is a link to manage the turno (the template's button) and the template is approved.
 * </ul>
 *
 * <p>A reminder inside the quiet hours (21:00–08:00 salon time) waits for 08:00 unless the turno
 * starts in under 12 hours ({@code DEFERRED}: nothing is marked, the next run finds it again).
 * Queuing marks {@code reminder_sent_at} in the SAME transaction (criterio 3), so a restart or a
 * second run cannot send it twice; if the message later fails, the email fallback of HU-WAP-07 goes
 * out once.
 *
 * <p>Only the link button is sent: the «Confirmo» / «No puedo ir» buttons need signed payloads and
 * a webhook that answers them (HU-WAP-06, C4).
 */
@Service
public class WhatsAppReminderNotifier {

  private static final Logger log = LoggerFactory.getLogger(WhatsAppReminderNotifier.class);

  public static final String PURPOSE = "REMINDER";

  public enum Outcome {
    /** Queued over WhatsApp and marked as reminded. */
    QUEUED,
    /** Quiet hours: try again at the next run. */
    DEFERRED,
    /** Not over WhatsApp: the email path takes over. */
    NOT_ELIGIBLE,
    /** No reminder at all (online booking still awaiting the salon's approval). */
    SKIPPED
  }

  public record Result(Outcome outcome, String reason) {
    static Result notEligible(String reason) {
      return new Result(Outcome.NOT_ELIGIBLE, reason);
    }
  }

  private final AppointmentRepository appointments;
  private final FemmeTimeProperties timeProperties;
  private final BookingMessagingSettings settings;
  private final WhatsAppAccess access;
  private final WhatsAppConsentService consent;
  private final ManageLinkProvider links;
  private final WhatsAppTemplateStatusService templateStatus;
  private final ReminderQuietHours quietHours;
  private final SalonDisplayName salonNames;
  private final WhatsAppOutbox outbox;
  private final AwaitingApprovalPolicy approvalPolicy;

  public WhatsAppReminderNotifier(
      AppointmentRepository appointments,
      FemmeTimeProperties timeProperties,
      BookingMessagingSettings settings,
      WhatsAppAccess access,
      WhatsAppConsentService consent,
      ManageLinkProvider links,
      WhatsAppTemplateStatusService templateStatus,
      ReminderQuietHours quietHours,
      SalonDisplayName salonNames,
      WhatsAppOutbox outbox,
      AwaitingApprovalPolicy approvalPolicy) {
    this.appointments = appointments;
    this.timeProperties = timeProperties;
    this.settings = settings;
    this.access = access;
    this.consent = consent;
    this.links = links;
    this.templateStatus = templateStatus;
    this.quietHours = quietHours;
    this.salonNames = salonNames;
    this.outbox = outbox;
    this.approvalPolicy = approvalPolicy;
  }

  @Transactional
  public Result tryWhatsApp(long appointmentId, Instant now) {
    Appointment appt = appointments.findById(appointmentId).orElse(null);
    if (appt == null) {
      return Result.notEligible("APPOINTMENT_NOT_FOUND");
    }
    if (appt.getReminderSentAt() != null) {
      return Result.notEligible("ALREADY_REMINDED");
    }
    long tenantId = appt.getTenant().getId();
    if (approvalPolicy.isAwaitingApproval(appt)) {
      return new Result(Outcome.SKIPPED, "AWAITING_APPROVAL");
    }
    if (!settings.remindersEnabled(tenantId)) {
      return Result.notEligible("REMINDERS_DISABLED");
    }
    if (!access.isChannelAvailable(tenantId)) {
      return Result.notEligible("CHANNEL_UNAVAILABLE");
    }
    Client client = appt.getClient();
    if (client == null) {
      return Result.notEligible("NO_CLIENT");
    }
    String phone = PhoneNumberNormalizer.normalize(client.getPhone()).orElse(null);
    if (phone == null) {
      return Result.notEligible("INVALID_PHONE");
    }
    Optional<WhatsAppConsentService.Block> block =
        consent.blockFor(tenantId, client.getId(), phone);
    if (block.isPresent()) {
      return Result.notEligible(block.get().name());
    }
    Optional<String> link = links.linkSuffix(tenantId, appointmentId);
    if (link.isEmpty()) {
      return Result.notEligible("NO_LINK");
    }
    WhatsAppTemplate template = WhatsAppTemplate.RECORDATORIO_TURNO;
    if (!templateStatus.isUsable(template.templateName(), WhatsAppTemplate.LANGUAGE)) {
      return Result.notEligible("TEMPLATE_UNAVAILABLE");
    }

    ZoneId zone = timeProperties.zoneId();
    if (quietHours.defers(now, appt.getStartAt(), zone)) {
      log.info(
          "WHATSAPP reminder deferred (quiet hours) tenantId={} appointmentId={}",
          tenantId,
          appointmentId);
      return new Result(Outcome.DEFERRED, "QUIET_HOURS");
    }

    List<String> variables =
        List.of(
            WhatsAppTemplateVariables.firstName(client.getFullName()),
            salonNames.of(tenantId, appt.getTenant()),
            appt.getSalonService().getName(),
            BookingNoticeFormatter.date(appt.getStartAt(), zone),
            BookingNoticeFormatter.time(appt.getStartAt(), zone));
    // Only the link button (index 2). The quick-reply buttons come with HU-WAP-06.
    WhatsAppOutboundMessage message =
        template.message(phone, variables, List.of(WhatsAppButton.url(2, link.get().trim())));
    String dedupKey = "appt:" + appointmentId + ":REMINDER:" + appt.getStartAt().getEpochSecond();
    outbox.enqueue(
        tenantId, appointmentId, client.getId(), PURPOSE, message, dedupKey, client.getEmail());
    appt.setReminderSentAt(Instant.now());
    log.info("WHATSAPP reminder queued tenantId={} appointmentId={}", tenantId, appointmentId);
    return new Result(Outcome.QUEUED, null);
  }
}
