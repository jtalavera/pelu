package com.cursorpoc.backend.web;

import com.cursorpoc.backend.domain.WhatsAppMessage;
import com.cursorpoc.backend.repository.AppointmentRepository;
import com.cursorpoc.backend.repository.WhatsAppMessageRepository;
import com.cursorpoc.backend.repository.WhatsAppOptOutRepository;
import com.cursorpoc.backend.repository.WhatsAppUnreachableRepository;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.ClientService;
import com.cursorpoc.backend.util.PhoneNumberNormalizer;
import com.cursorpoc.backend.whatsapp.BookingContact;
import com.cursorpoc.backend.whatsapp.BookingEvent;
import com.cursorpoc.backend.whatsapp.BookingNotifier;
import com.cursorpoc.backend.whatsapp.FakeFallbackEmailSender;
import com.cursorpoc.backend.whatsapp.FakeWhatsAppGateway;
import com.cursorpoc.backend.whatsapp.PropertyBookingMessagingSettings;
import com.cursorpoc.backend.whatsapp.WhatsAppButton;
import com.cursorpoc.backend.whatsapp.WhatsAppConsentService;
import com.cursorpoc.backend.whatsapp.WhatsAppDispatcher;
import com.cursorpoc.backend.whatsapp.WhatsAppErrorCode;
import com.cursorpoc.backend.whatsapp.WhatsAppOutboundMessage;
import com.cursorpoc.backend.whatsapp.WhatsAppOutbox;
import com.cursorpoc.backend.whatsapp.WhatsAppRetentionJob;
import com.cursorpoc.backend.whatsapp.WhatsAppSendException;
import com.cursorpoc.backend.whatsapp.WhatsAppSender;
import com.cursorpoc.backend.whatsapp.WhatsAppTemplate;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * e2e only (same guard as {@link AppointmentTestSupportController}: {@code
 * femme.data-init.enabled=true}, AND the fake provider so it can never read a real send). Lets the
 * Playwright suite read the messages the fake "sent", make the next sends fail, and set a
 * template's approval status. MUST stay disabled in production; {@code
 * WhatsAppTestSupportDisabledByDefaultTest} checks the guard.
 */
@RestController
@RequestMapping("/api/admin/whatsapp-test-support")
@ConditionalOnExpression(
    "'${femme.data-init.enabled:false}' == 'true'"
        + " and '${app.femme.whatsapp.provider:meta}' == 'fake'")
public class WhatsAppTestSupportController {

  private static final Logger log = LoggerFactory.getLogger(WhatsAppTestSupportController.class);

  public record SentRow(
      String wamid,
      Instant at,
      String to,
      String template,
      String language,
      List<String> bodyParameters,
      List<WhatsAppButton> buttons) {}

  public record FailNextRequest(String code, Integer count) {}

  public record TemplateStatusRequest(String status, String reason) {}

  public record ButtonDto(String kind, int index, String value) {}

  /** {@code rollback=true} makes the caller's transaction fail after queueing (HU-WAP-01 §3). */
  public record EnqueueRequest(
      String template,
      String to,
      List<String> variables,
      List<ButtonDto> buttons,
      String dedupKey,
      Boolean rollback,
      String fallbackEmail,
      Long clientId,
      String purpose,
      Long appointmentId) {}

  public record PhoneRequest(String phone) {}

  /**
   * Stands in for what A4/A5/A6 will do: tells the client about a booking event. {@code mode}
   * {@code CLIENT} = a salon-made turno (the client's own phone, email and consent); {@code ONLINE}
   * = the turno's own contact with the consent of the booking form. {@code rollback=true} fails the
   * caller's transaction afterwards.
   */
  public record BookingNoticeRequest(
      Long appointmentId,
      String event,
      String mode,
      String fullName,
      String phone,
      String email,
      Boolean optIn,
      String linkSuffix,
      Boolean rollback) {}

  public record NoticesEnabledRequest(Boolean enabled) {}

  public record SendCodeRequest(String to, String code) {}

  private final FakeWhatsAppGateway gateway;
  private final WhatsAppMessageRepository messages;
  private final WhatsAppOutbox outbox;
  private final WhatsAppSender sender;
  private final TransactionTemplate tx;
  private final FakeFallbackEmailSender emails;
  private final WhatsAppConsentService consent;
  private final WhatsAppOptOutRepository optOuts;
  private final WhatsAppUnreachableRepository unreachable;
  private final WhatsAppDispatcher dispatcher;
  private final WhatsAppRetentionJob retention;
  private final ClientService clientService;
  private final BookingNotifier bookingNotifier;
  private final PropertyBookingMessagingSettings bookingSettings;
  private final AppointmentRepository appointmentRepository;

  public WhatsAppTestSupportController(
      FakeWhatsAppGateway gateway,
      WhatsAppMessageRepository messages,
      WhatsAppOutbox outbox,
      WhatsAppSender sender,
      PlatformTransactionManager transactionManager,
      FakeFallbackEmailSender emails,
      WhatsAppConsentService consent,
      WhatsAppOptOutRepository optOuts,
      WhatsAppUnreachableRepository unreachable,
      WhatsAppDispatcher dispatcher,
      WhatsAppRetentionJob retention,
      ClientService clientService,
      BookingNotifier bookingNotifier,
      PropertyBookingMessagingSettings bookingSettings,
      AppointmentRepository appointmentRepository) {
    this.bookingNotifier = bookingNotifier;
    this.bookingSettings = bookingSettings;
    this.appointmentRepository = appointmentRepository;
    this.clientService = clientService;
    this.emails = emails;
    this.consent = consent;
    this.optOuts = optOuts;
    this.unreachable = unreachable;
    this.dispatcher = dispatcher;
    this.retention = retention;
    this.gateway = gateway;
    this.messages = messages;
    this.outbox = outbox;
    this.sender = sender;
    this.tx = new TransactionTemplate(transactionManager);
  }

  /**
   * Queues a message for the caller's salon inside a transaction, standing in for "an appointment
   * was created/approved/cancelled". With {@code rollback=true} the transaction fails afterwards:
   * no message may exist and nothing may be sent.
   */
  @PostMapping("/enqueue")
  public Map<String, Object> enqueue(
      @AuthenticationPrincipal FemmeUserPrincipal p, @RequestBody EnqueueRequest body) {
    requireTenant(p);
    WhatsAppTemplate template = WhatsAppTemplate.byName(body.template());
    String to = PhoneNumberNormalizer.normalize(body.to()).orElse(null);
    if (template == null || to == null || body.dedupKey() == null) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_TEST_REQUEST");
    }
    List<WhatsAppButton> buttons =
        (body.buttons() == null ? List.<ButtonDto>of() : body.buttons())
            .stream()
                .map(
                    b ->
                        new WhatsAppButton(
                            WhatsAppButton.Kind.valueOf(b.kind()), b.index(), b.value()))
                .toList();
    WhatsAppOutboundMessage message;
    try {
      message = template.message(to, body.variables(), buttons);
    } catch (WhatsAppSendException ex) {
      throw PlatformWhatsAppController.toHttp(ex);
    }
    boolean rollback = Boolean.TRUE.equals(body.rollback());
    try {
      Long id =
          tx.execute(
              status -> {
                WhatsAppMessage m =
                    outbox.enqueue(
                        p.getTenantId(),
                        body.appointmentId(),
                        body.clientId(),
                        body.purpose() == null ? "BOOKING" : body.purpose(),
                        message,
                        body.dedupKey(),
                        body.fallbackEmail());
                if (rollback) {
                  throw new IllegalStateException("ROLLBACK_REQUESTED");
                }
                return m.getId();
              });
      return Map.of("id", id, "rolledBack", false);
    } catch (IllegalStateException ex) {
      if ("ROLLBACK_REQUESTED".equals(ex.getMessage())) {
        return Map.of("rolledBack", true);
      }
      throw ex;
    }
  }

  /** The synchronous send of a verification code for the caller's salon. */
  @PostMapping("/send-code")
  public Map<String, String> sendCode(
      @AuthenticationPrincipal FemmeUserPrincipal p, @RequestBody SendCodeRequest body) {
    requireTenant(p);
    try {
      return Map.of(
          "wamid", sender.sendVerificationCode(p.getTenantId(), body.to(), body.code()).wamid());
    } catch (WhatsAppSendException ex) {
      throw PlatformWhatsAppController.toHttp(ex);
    }
  }

  @GetMapping("/sent")
  public List<SentRow> sent(@AuthenticationPrincipal FemmeUserPrincipal p) {
    require(p);
    return gateway.sentMessages().stream()
        .map(
            s ->
                new SentRow(
                    s.wamid(),
                    s.at(),
                    s.message().to(),
                    s.message().templateName(),
                    s.message().languageCode(),
                    s.message().bodyParameters(),
                    s.message().buttons()))
        .toList();
  }

  /** The delivery log of the caller's salon (never another tenant's). */
  @GetMapping("/log")
  public List<Map<String, Object>> log(@AuthenticationPrincipal FemmeUserPrincipal p) {
    requireTenant(p);
    long tenantId = p.getTenantId();
    return messages.findAll().stream()
        .filter(m -> m.getTenantId() == tenantId)
        .map(
            m -> {
              Map<String, Object> row = new java.util.LinkedHashMap<>();
              row.put("id", m.getId());
              row.put("appointmentId", m.getAppointmentId());
              row.put("clientId", m.getClientId());
              row.put("purpose", m.getPurpose());
              row.put("template", m.getTemplate());
              row.put("status", m.getStatus());
              row.put("errorCode", m.getErrorCode() == null ? "" : m.getErrorCode());
              row.put("wamid", m.getMetaMessageId() == null ? "" : m.getMetaMessageId());
              row.put("attempts", m.getAttempts());
              row.put("recipient", m.getRecipient());
              row.put("fallbackEmailSent", m.getFallbackEmailSentAt() != null);
              row.put("fallbackEmail", m.getFallbackEmail() == null ? "" : m.getFallbackEmail());
              row.put(
                  "nextAttemptAt",
                  m.getNextAttemptAt() == null ? "" : m.getNextAttemptAt().toString());
              row.put("masked", m.getRecipientMaskedAt() != null);
              row.put("payload", m.getPayload());
              return row;
            })
        .toList();
  }

  /** Tells the client about a booking event of one of the caller's appointments (HU-WAP-04). */
  @PostMapping("/booking-notice")
  public Map<String, Object> bookingNotice(
      @AuthenticationPrincipal FemmeUserPrincipal p, @RequestBody BookingNoticeRequest body) {
    requireTenant(p);
    BookingEvent event;
    try {
      event = BookingEvent.valueOf(body.event());
    } catch (RuntimeException ex) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_TEST_REQUEST");
    }
    long tenantId = p.getTenantId();
    boolean rollback = Boolean.TRUE.equals(body.rollback());
    try {
      BookingNotifier.Outcome outcome =
          tx.execute(
              status -> {
                BookingContact contact;
                if ("ONLINE".equals(body.mode())) {
                  contact =
                      BookingContact.online(
                          body.fullName(),
                          body.phone(),
                          body.email(),
                          Boolean.TRUE.equals(body.optIn()));
                } else {
                  var appt =
                      appointmentRepository
                          .findByIdAndTenant_Id(body.appointmentId(), tenantId)
                          .orElseThrow(
                              () ->
                                  new ResponseStatusException(
                                      HttpStatus.NOT_FOUND, "APPOINTMENT_NOT_FOUND"));
                  if (appt.getClient() == null) {
                    throw new ResponseStatusException(
                        HttpStatus.BAD_REQUEST, "INVALID_TEST_REQUEST");
                  }
                  contact = BookingContact.ofClient(appt.getClient());
                }
                BookingNotifier.Outcome o =
                    bookingNotifier.notify(
                        tenantId, body.appointmentId(), event, contact, body.linkSuffix());
                if (rollback) {
                  throw new IllegalStateException("ROLLBACK_REQUESTED");
                }
                return o;
              });
      Map<String, Object> out = new java.util.LinkedHashMap<>();
      out.put("channel", outcome.channel().name());
      out.put("reason", outcome.reason() == null ? "" : outcome.reason());
      out.put("messageId", outcome.messageId());
      out.put("rolledBack", false);
      return out;
    } catch (IllegalStateException ex) {
      if ("ROLLBACK_REQUESTED".equals(ex.getMessage())) {
        return Map.of("rolledBack", true);
      }
      throw ex;
    }
  }

  /**
   * Turns the salon's «Confirmaciones de reserva» switch on/off ({@code null}: back to the
   * default).
   */
  @PostMapping("/booking-notices-enabled")
  public Map<String, Boolean> bookingNoticesEnabled(
      @AuthenticationPrincipal FemmeUserPrincipal p, @RequestBody NoticesEnabledRequest body) {
    requireTenant(p);
    bookingSettings.override(p.getTenantId(), body.enabled());
    return Map.of("ok", true);
  }

  /** The id of the salon's generic "cliente ocasional" (created on first use). */
  @GetMapping("/generic-client")
  public Map<String, Long> genericClient(@AuthenticationPrincipal FemmeUserPrincipal p) {
    requireTenant(p);
    return Map.of("id", clientService.getOrCreateGenericClient(p.getTenantId()).getId());
  }

  /** The emails the fake fallback sender "sent". */
  @GetMapping("/emails")
  public List<FakeFallbackEmailSender.SentEmail> sentEmails(
      @AuthenticationPrincipal FemmeUserPrincipal p) {
    require(p);
    return emails.sentEmails();
  }

  @PostMapping("/emails/fail-next")
  public Map<String, Boolean> failNextEmail(
      @AuthenticationPrincipal FemmeUserPrincipal p,
      @RequestParam(name = "count", defaultValue = "1") int count) {
    require(p);
    emails.failNext(count);
    return Map.of("ok", true);
  }

  /** Forgets everything the fake keeps: sent messages and emails, opt-outs, unreachable numbers. */
  @DeleteMapping("/state")
  public Map<String, Boolean> resetState(@AuthenticationPrincipal FemmeUserPrincipal p) {
    require(p);
    gateway.clear();
    emails.clear();
    optOuts.deleteAll();
    unreachable.deleteAll();
    return Map.of("ok", true);
  }

  /** A phone asked to stop receiving notices (what a BAJA reply will do from HU-WAP-06). */
  @PostMapping("/opt-outs")
  public Map<String, Boolean> optOut(
      @AuthenticationPrincipal FemmeUserPrincipal p, @RequestBody PhoneRequest body) {
    require(p);
    String phone = PhoneNumberNormalizer.normalize(body.phone()).orElse(null);
    if (phone == null) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_TEST_REQUEST");
    }
    consent.optOut(phone, "REPLY");
    return Map.of("ok", true);
  }

  /**
   * Makes the retries of the caller's salon due now and runs the sweep (instead of waiting
   * minutes).
   */
  @PostMapping("/expedite")
  public Map<String, Integer> expedite(@AuthenticationPrincipal FemmeUserPrincipal p) {
    requireTenant(p);
    long tenantId = p.getTenantId();
    Integer n =
        tx.execute(
            status -> {
              int count = 0;
              for (WhatsAppMessage m : messages.findAll()) {
                if (m.getTenantId() == tenantId
                    && WhatsAppMessage.QUEUED.equals(m.getStatus())
                    && m.getNextAttemptAt() != null) {
                  m.setNextAttemptAt(Instant.now().minusSeconds(1));
                  messages.save(m);
                  count++;
                }
              }
              return count;
            });
    dispatcher.sweep();
    return Map.of("expedited", n == null ? 0 : n);
  }

  /** Backdates the caller's finished messages so the retention period has passed. */
  @PostMapping("/age-messages")
  public Map<String, Integer> age(
      @AuthenticationPrincipal FemmeUserPrincipal p, @RequestParam("days") int days) {
    requireTenant(p);
    long tenantId = p.getTenantId();
    Integer n =
        tx.execute(
            status -> {
              int count = 0;
              for (WhatsAppMessage m : messages.findAll()) {
                if (m.getTenantId() == tenantId
                    && !WhatsAppMessage.QUEUED.equals(m.getStatus())
                    && !WhatsAppMessage.SENDING.equals(m.getStatus())) {
                  m.setQueuedAt(Instant.now().minusSeconds(days * 86_400L));
                  messages.save(m);
                  count++;
                }
              }
              return count;
            });
    return Map.of("aged", n == null ? 0 : n);
  }

  /** Runs the retention job now. */
  @PostMapping("/retention")
  public Map<String, Integer> runRetention(@AuthenticationPrincipal FemmeUserPrincipal p) {
    require(p);
    retention.run();
    return Map.of("ok", 1);
  }

  @DeleteMapping("/sent")
  public Map<String, Boolean> clear(@AuthenticationPrincipal FemmeUserPrincipal p) {
    require(p);
    gateway.clear();
    return Map.of("ok", true);
  }

  @PostMapping("/fail-next")
  public Map<String, Boolean> failNext(
      @AuthenticationPrincipal FemmeUserPrincipal p, @RequestBody FailNextRequest body) {
    require(p);
    WhatsAppErrorCode code;
    try {
      code = WhatsAppErrorCode.valueOf(body.code());
    } catch (RuntimeException ex) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_ERROR_CODE");
    }
    gateway.failNext(code, body.count() == null ? 1 : body.count());
    return Map.of("ok", true);
  }

  @PostMapping("/templates/{name}/status")
  public Map<String, Boolean> templateStatus(
      @AuthenticationPrincipal FemmeUserPrincipal p,
      @PathVariable("name") String name,
      @RequestBody TemplateStatusRequest body) {
    require(p);
    gateway.setTemplateStatus(name, body.status(), body.reason());
    return Map.of("ok", true);
  }

  private static void requireTenant(FemmeUserPrincipal p) {
    require(p);
    if (!p.hasTenant()) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "FORBIDDEN");
    }
  }

  private static void require(FemmeUserPrincipal p) {
    if (p == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    log.info("whatsapp-test-support tenantId={}", p.hasTenant() ? p.getTenantId() : "n/a");
  }
}
