package com.cursorpoc.backend.whatsapp;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.Appointment;
import com.cursorpoc.backend.domain.WhatsAppMessage;
import com.cursorpoc.backend.repository.AppointmentRepository;
import com.cursorpoc.backend.util.PhoneNumberNormalizer;
import java.time.ZoneId;
import java.util.List;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * HU-WAP-04: tells the client what happened to her booking (confirmed, pending approval, rejected
 * or expired, another time proposed, cancelled). Whoever changes the appointment — the online
 * booking (A4), the management link (A5), the approval of requests (A6) — calls {@link #notify}
 * INSIDE its own transaction:
 *
 * <ul>
 *   <li>The notice is written in that transaction and leaves after the commit; if the caller rolls
 *       back there is no notice, and a failed send never undoes the booking (RT-14).
 *   <li>One notice per (turno, event, schedule version): repeated calls, double clicks or a
 *       repeated approval do not duplicate it (criterio 3). A new schedule is a new version.
 *   <li>A reschedule cancels the notices still queued for the old time; a cancellation cancels
 *       every queued one (criterio 5).
 *   <li>WhatsApp only with the salon's switch on, the channel available, a valid phone and a valid
 *       consent that is not opted out nor unreachable (RT-11). Otherwise the notice goes by email
 *       if there is an address, and is only recorded if there is none (criterio 6).
 *   <li>The content is only what the template carries: first name, salon, service, date, time and
 *       professional. Never amounts, notes or health data, and never the free-text reason of a
 *       rejection (RT-13, criterios 7 y 9).
 * </ul>
 *
 * <p>Creating a turno from the salon's agenda sends NOTHING (criterio 8): nobody calls this for it.
 */
@Service
public class BookingNotifier {

  private static final Logger log = LoggerFactory.getLogger(BookingNotifier.class);

  /** Purposes whose queued messages a reschedule or cancellation makes stale. */
  static final List<String> PURPOSES = List.of("BOOKING", "REMINDER");

  public static final String PURPOSE = "BOOKING";
  public static final String REASON_NOTICES_DISABLED = "NOTICES_DISABLED";
  public static final String REASON_CHANNEL_UNAVAILABLE = "CHANNEL_UNAVAILABLE";
  public static final String REASON_INVALID_PHONE = "INVALID_PHONE";
  public static final String REASON_NO_CONSENT = "NO_CONSENT";
  public static final String REASON_SUPERSEDED = "SUPERSEDED";

  /** Where the notice went. */
  public enum Channel {
    WHATSAPP,
    EMAIL,
    /** No consent/channel and no email: only recorded, the salon has to call. */
    NONE
  }

  /** What {@link #notify} did. {@code reason} says why WhatsApp was not used, if it was not. */
  public record Outcome(Channel channel, String reason, Long messageId) {}

  private final AppointmentRepository appointments;
  private final SalonDisplayName salonNames;
  private final FemmeTimeProperties timeProperties;
  private final WhatsAppAccess access;
  private final WhatsAppConsentService consent;
  private final WhatsAppOutbox outbox;
  private final BookingMessagingSettings settings;

  public BookingNotifier(
      AppointmentRepository appointments,
      SalonDisplayName salonNames,
      FemmeTimeProperties timeProperties,
      WhatsAppAccess access,
      WhatsAppConsentService consent,
      WhatsAppOutbox outbox,
      BookingMessagingSettings settings) {
    this.appointments = appointments;
    this.salonNames = salonNames;
    this.timeProperties = timeProperties;
    this.access = access;
    this.consent = consent;
    this.outbox = outbox;
    this.settings = settings;
  }

  /**
   * @param linkSuffix the variable part of the button's URL: {@code <slug>/turno/<token>} to see or
   *     change the booking, or just {@code <slug>} to book again (rejected, cancelled)
   */
  @Transactional
  public Outcome notify(
      long tenantId,
      long appointmentId,
      BookingEvent event,
      BookingContact contact,
      String linkSuffix) {
    if (linkSuffix == null || linkSuffix.isBlank()) {
      throw new IllegalArgumentException(
          "linkSuffix is required: the templates have a link button");
    }
    Appointment appt =
        appointments
            .findByIdAndTenant_Id(appointmentId, tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "APPOINTMENT_NOT_FOUND"));

    String version = ":" + appt.getStartAt().getEpochSecond();
    String dedupKey = "appt:" + appointmentId + ":" + event.name() + version;

    // A cancellation voids everything still queued; any other event only voids the notices of an
    // OLDER schedule (a reschedule).
    int voided =
        outbox.cancelQueued(
            tenantId,
            appointmentId,
            PURPOSES,
            event == BookingEvent.CANCELLED ? null : version,
            REASON_SUPERSEDED);
    if (voided > 0) {
      log.info(
          "WHATSAPP queued notices superseded tenantId={} appointmentId={} count={} event={}",
          tenantId,
          appointmentId,
          voided,
          event);
    }

    String normalizedPhone = PhoneNumberNormalizer.normalize(contact.phone()).orElse(null);
    WhatsAppOutboundMessage message =
        build(
            tenantId,
            appt,
            event,
            contact,
            normalizedPhone == null ? "" : normalizedPhone,
            linkSuffix);

    Long clientIdForConsent =
        contact.basis() == BookingContact.Basis.CLIENT && appt.getClient() != null
            ? appt.getClient().getId()
            : null;
    String reason = whyNotWhatsApp(tenantId, contact, normalizedPhone, clientIdForConsent);

    WhatsAppMessage row;
    if (reason == null) {
      row =
          outbox.enqueue(
              tenantId,
              appointmentId,
              clientIdForConsent,
              PURPOSE,
              message,
              dedupKey,
              contact.email());
    } else {
      row =
          outbox.enqueueUndeliverable(
              tenantId,
              appointmentId,
              clientIdForConsent,
              PURPOSE,
              message,
              dedupKey,
              contact.email(),
              reason);
      log.info(
          "WHATSAPP booking notice not sent over WhatsApp tenantId={} appointmentId={} event={}"
              + " reason={}",
          tenantId,
          appointmentId,
          event,
          reason);
    }
    return new Outcome(channelOf(row, reason), reason, row.getId());
  }

  /** Why this notice cannot go over WhatsApp, or {@code null} if it can. */
  private String whyNotWhatsApp(
      long tenantId, BookingContact contact, String normalizedPhone, Long clientIdForConsent) {
    if (!settings.bookingNoticesEnabled(tenantId)) {
      return REASON_NOTICES_DISABLED;
    }
    if (!access.isChannelAvailable(tenantId)) {
      return REASON_CHANNEL_UNAVAILABLE;
    }
    if (normalizedPhone == null) {
      return REASON_INVALID_PHONE;
    }
    if (contact.basis() == BookingContact.Basis.NONE
        || (contact.basis() == BookingContact.Basis.CLIENT && clientIdForConsent == null)) {
      return REASON_NO_CONSENT;
    }
    Optional<WhatsAppConsentService.Block> block =
        consent.blockFor(tenantId, clientIdForConsent, normalizedPhone);
    return block.map(Enum::name).orElse(null);
  }

  private static Channel channelOf(WhatsAppMessage row, String reason) {
    if (reason == null) {
      return Channel.WHATSAPP;
    }
    return row.getFallbackEmail() != null || row.getFallbackEmailSentAt() != null
        ? Channel.EMAIL
        : Channel.NONE;
  }

  private WhatsAppOutboundMessage build(
      long tenantId,
      Appointment appt,
      BookingEvent event,
      BookingContact contact,
      String to,
      String linkSuffix) {
    ZoneId zone = timeProperties.zoneId();
    String name = WhatsAppTemplateVariables.firstName(contact.fullName());
    String salon = salonNames.of(tenantId, appt.getTenant());
    String service = appt.getSalonService().getName();
    String date = BookingNoticeFormatter.date(appt.getStartAt(), zone);
    String time = BookingNoticeFormatter.time(appt.getStartAt(), zone);
    String professional = appt.getProfessional().getDisplayName();

    List<String> variables =
        switch (event) {
          case CONFIRMED -> List.of(name, salon, service, date, time, professional);
          case PENDING -> List.of(name, salon, service, date, time);
          case REJECTED, PROPOSAL, CANCELLED -> List.of(name, salon, service, date);
        };
    return event
        .template()
        .message(to, variables, List.of(WhatsAppButton.url(0, linkSuffix.trim())));
  }
}
