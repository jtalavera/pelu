package com.cursorpoc.backend.whatsapp;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.Appointment;
import com.cursorpoc.backend.domain.WhatsAppAutoReply;
import com.cursorpoc.backend.domain.enums.AppointmentStatus;
import com.cursorpoc.backend.repository.AppointmentRepository;
import com.cursorpoc.backend.repository.BusinessProfileRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.repository.WhatsAppAutoReplyRepository;
import com.cursorpoc.backend.repository.WhatsAppMessageRepository;
import com.cursorpoc.backend.service.AppointmentService;
import com.cursorpoc.backend.service.AuditLogService;
import com.cursorpoc.backend.util.PhoneNumberNormalizer;
import com.cursorpoc.backend.web.dto.AppointmentStatusUpdateRequest;
import java.text.Normalizer;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * HU-WAP-06: what happens when a client writes to the shared number. The message was already
 * authenticated (signature) and de-duplicated by the caller; nothing here logs its text or a full
 * phone number (RT-13).
 *
 * <p>What it does, in order: a signed button payload from the phone it was sent to ({@code
 * Confirmo}, {@code No puedo ir} and its two-button question); the words {@code BAJA/STOP/NO
 * QUIERO} and {@code ALTA}; anything else — free text, audio, images — gets one fixed text per
 * phone per 24 h. A button whose signature fails, or that comes from another phone, or from a salon
 * with button replies off, is treated as free text. Tenant and turno always come from the verified
 * payload / the messages we sent, never from what the client says.
 */
@Service
public class WhatsAppInboundService {

  private static final Logger log = LoggerFactory.getLogger(WhatsAppInboundService.class);

  public enum Kind {
    TEXT,
    BUTTON,
    OTHER
  }

  /**
   * {@code from}: the sender in E.164 ({@code +595…}). {@code text}/{@code payload}: may be null.
   */
  public record Inbound(String id, String from, Kind kind, String text, String payload) {}

  static final Duration ATTRIBUTION_WINDOW = Duration.ofHours(72);
  static final Duration AUTO_REPLY_EVERY = Duration.ofHours(24);
  private static final Duration SEND_TIMEOUT = Duration.ofSeconds(10);
  private static final Set<String> OPT_OUT_WORDS = Set.of("baja", "stop", "no quiero");
  private static final Set<String> OPT_IN_WORDS = Set.of("alta");

  private final WhatsAppGateway gateway;
  private final WhatsAppSettings settings;
  private final WhatsAppPayloads payloads;
  private final WhatsAppConsentService consent;
  private final WhatsAppAccess access;
  private final BookingMessagingSettings messagingSettings;
  private final AwaitingApprovalPolicy approvalPolicy;
  private final CancellationPolicy cancellationPolicy;
  private final AppointmentRepository appointments;
  private final AppointmentService appointmentService;
  private final WhatsAppMessageRepository messages;
  private final WhatsAppAutoReplyRepository autoReplies;
  private final TenantRepository tenants;
  private final BusinessProfileRepository businessProfiles;
  private final SalonDisplayName salonNames;
  private final AuditLogService audit;
  private final FemmeTimeProperties timeProperties;

  public WhatsAppInboundService(
      WhatsAppGateway gateway,
      WhatsAppSettings settings,
      WhatsAppPayloads payloads,
      WhatsAppConsentService consent,
      WhatsAppAccess access,
      BookingMessagingSettings messagingSettings,
      AwaitingApprovalPolicy approvalPolicy,
      CancellationPolicy cancellationPolicy,
      AppointmentRepository appointments,
      AppointmentService appointmentService,
      WhatsAppMessageRepository messages,
      WhatsAppAutoReplyRepository autoReplies,
      TenantRepository tenants,
      BusinessProfileRepository businessProfiles,
      SalonDisplayName salonNames,
      AuditLogService audit,
      FemmeTimeProperties timeProperties) {
    this.gateway = gateway;
    this.settings = settings;
    this.payloads = payloads;
    this.consent = consent;
    this.access = access;
    this.messagingSettings = messagingSettings;
    this.approvalPolicy = approvalPolicy;
    this.cancellationPolicy = cancellationPolicy;
    this.appointments = appointments;
    this.appointmentService = appointmentService;
    this.messages = messages;
    this.autoReplies = autoReplies;
    this.tenants = tenants;
    this.businessProfiles = businessProfiles;
    this.salonNames = salonNames;
    this.audit = audit;
    this.timeProperties = timeProperties;
  }

  @Transactional
  public void handle(Inbound in) {
    String phone = PhoneNumberNormalizer.normalize(in.from()).orElse(null);
    if (phone == null) {
      log.info("WHATSAPP inbound ignored (sender not a valid phone)");
      return;
    }
    Instant now = Instant.now();

    if (in.kind() == Kind.BUTTON) {
      Optional<WhatsAppPayloads.Parsed> parsed = payloads.verify(in.payload());
      if (parsed.isPresent() && handleButton(phone, parsed.get(), now)) {
        return;
      }
      // Unsigned, foreign, expired or disabled: nothing to act on, it is just a message.
      freeMessage(phone, now);
      return;
    }
    if (in.kind() == Kind.TEXT) {
      String word = normalizeWord(in.text());
      if (OPT_OUT_WORDS.contains(word)) {
        consent.optOut(phone, "BAJA");
        log.info("WHATSAPP opt-out by reply phone={}", PhoneNumberNormalizer.mask(phone));
        reply(phone, WhatsAppReplyTexts.optedOut());
        return;
      }
      if (OPT_IN_WORDS.contains(word)) {
        consent.optIn(phone);
        log.info("WHATSAPP opt-in by reply phone={}", PhoneNumberNormalizer.mask(phone));
        reply(phone, WhatsAppReplyTexts.optedIn());
        return;
      }
    }
    freeMessage(phone, now);
  }

  // ── Buttons ────────────────────────────────────────────────────────────────────────────────

  /** Returns false when the tap cannot be attended (the caller treats it as a free message). */
  private boolean handleButton(String phone, WhatsAppPayloads.Parsed p, Instant now) {
    Appointment appt = appointments.findById(p.appointmentId()).orElse(null);
    if (appt == null || appt.getClient() == null) {
      return false;
    }
    long tenantId = appt.getTenant().getId();
    String clientPhone = PhoneNumberNormalizer.normalize(appt.getClient().getPhone()).orElse(null);
    if (!phone.equals(clientPhone)
        || !messagingSettings.buttonRepliesEnabled(tenantId)
        || !access.isChannelAvailable(tenantId)) {
      return false;
    }
    ZoneId zone = timeProperties.zoneId();
    String date = BookingNoticeFormatter.date(appt.getStartAt(), zone);
    String time = BookingNoticeFormatter.time(appt.getStartAt(), zone);
    String salon = salonNames.of(tenantId, appt.getTenant());
    boolean active =
        (appt.getStatus() == AppointmentStatus.PENDING
                || appt.getStatus() == AppointmentStatus.CONFIRMED)
            && appt.getStartAt().isAfter(now);

    switch (p.action()) {
      case CONFIRM -> {
        if (!active) {
          reply(phone, WhatsAppReplyTexts.notCurrent());
          return true;
        }
        if (appt.getClientConfirmedAt() == null) {
          appt.setClientConfirmedAt(now);
        }
        if (appt.getStatus() == AppointmentStatus.PENDING
            && !approvalPolicy.isAwaitingApproval(appt)) {
          appointmentService.updateStatus(
              tenantId, appt.getId(), new AppointmentStatusUpdateRequest("CONFIRMED", null));
        }
        audit.recordExternalAction(
            tenantId,
            "client-whatsapp",
            "appointments",
            "client-confirm",
            String.valueOf(appt.getId()),
            AuditLogService.SOURCE_WHATSAPP);
        log.info("WHATSAPP client confirmed tenantId={} appointmentId={}", tenantId, appt.getId());
        reply(
            phone,
            WhatsAppReplyTexts.confirmed(
                WhatsAppTemplateVariables.firstName(appt.getClient().getFullName()),
                date,
                time,
                salon));
      }
      case CANT_GO -> {
        if (!active) {
          reply(phone, WhatsAppReplyTexts.notCurrent());
          return true;
        }
        replyWithButtons(
            phone,
            WhatsAppReplyTexts.askCancel(date, time, salon),
            List.of(
                new WhatsAppSessionMessage.ReplyButton(
                    payloads.sign(WhatsAppPayloads.Action.CANCEL_YES, appt.getId()),
                    "Sí, cancelar"),
                new WhatsAppSessionMessage.ReplyButton(
                    payloads.sign(WhatsAppPayloads.Action.CANCEL_NO, appt.getId()),
                    "No, mantener")));
      }
      case CANCEL_NO -> {
        if (!active) {
          reply(phone, WhatsAppReplyTexts.notCurrent());
          return true;
        }
        reply(phone, WhatsAppReplyTexts.kept(date, time));
      }
      case CANCEL_YES -> {
        if (appt.getStatus() == AppointmentStatus.CANCELLED) {
          reply(phone, WhatsAppReplyTexts.cancelled(date, time)); // a double tap
          return true;
        }
        if (!active) {
          reply(phone, WhatsAppReplyTexts.notCurrent());
          return true;
        }
        if (!cancellationPolicy.allowsClientCancellation(appt, now)) {
          String salonPhone =
              businessProfiles.findByTenantId(tenantId).map(b -> b.getPhone()).orElse(null);
          reply(phone, WhatsAppReplyTexts.tooLateToCancel(salon, salonPhone));
          return true;
        }
        appointmentService.updateStatus(
            tenantId,
            appt.getId(),
            new AppointmentStatusUpdateRequest("CANCELLED", "CLIENT_WHATSAPP"));
        audit.recordExternalAction(
            tenantId,
            "client-whatsapp",
            "appointments",
            "client-cancel",
            String.valueOf(appt.getId()),
            AuditLogService.SOURCE_WHATSAPP);
        log.info("WHATSAPP client cancelled tenantId={} appointmentId={}", tenantId, appt.getId());
        reply(phone, WhatsAppReplyTexts.cancelled(date, time));
      }
    }
    return true;
  }

  // ── Free messages ──────────────────────────────────────────────────────────────────────────

  private void freeMessage(String phone, Instant now) {
    Optional<WhatsAppAutoReply> last = autoReplies.findById(phone);
    if (last.isPresent() && last.get().getRepliedAt().isAfter(now.minus(AUTO_REPLY_EVERY))) {
      return;
    }
    if (last.isPresent()) {
      last.get().setRepliedAt(now);
    } else {
      autoReplies.save(new WhatsAppAutoReply(phone, now));
    }
    String salon = null;
    String salonPhone = null;
    List<Long> tenantIds = messages.findTenantIdsSentTo(phone, now.minus(ATTRIBUTION_WINDOW));
    if (tenantIds.size() == 1) {
      long tenantId = tenantIds.get(0);
      var tenant = tenants.findById(tenantId).orElse(null);
      if (tenant != null) {
        salon = salonNames.of(tenantId, tenant);
        salonPhone = businessProfiles.findByTenantId(tenantId).map(b -> b.getPhone()).orElse(null);
      }
    }
    reply(phone, WhatsAppReplyTexts.noticesOnly(salon, salonPhone));
  }

  // ── Sending (never throws: a failed reply must not undo what was already done) ──────────────

  private void reply(String phone, String text) {
    send(WhatsAppSessionMessage.text(phone, text));
  }

  private void replyWithButtons(
      String phone, String text, List<WhatsAppSessionMessage.ReplyButton> buttons) {
    send(new WhatsAppSessionMessage(phone, text, buttons));
  }

  private void send(WhatsAppSessionMessage message) {
    if (!settings.isOperational()) {
      return;
    }
    try {
      gateway.sendSession(message, SEND_TIMEOUT);
    } catch (RuntimeException ex) {
      log.error("WHATSAPP reply failed error={}", ex.toString());
    }
  }

  /** Lower case, no accents or punctuation, single spaces: «¡Baja!» → «baja». */
  static String normalizeWord(String raw) {
    if (raw == null) {
      return "";
    }
    String s = Normalizer.normalize(raw, Normalizer.Form.NFD).replaceAll("\\p{M}+", "");
    s = s.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", " ").trim();
    return s;
  }
}
