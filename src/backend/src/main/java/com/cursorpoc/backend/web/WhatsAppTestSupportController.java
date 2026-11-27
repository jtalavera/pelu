package com.cursorpoc.backend.web;

import com.cursorpoc.backend.domain.WhatsAppMessage;
import com.cursorpoc.backend.repository.WhatsAppMessageRepository;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.util.PhoneNumberNormalizer;
import com.cursorpoc.backend.whatsapp.FakeWhatsAppGateway;
import com.cursorpoc.backend.whatsapp.WhatsAppButton;
import com.cursorpoc.backend.whatsapp.WhatsAppErrorCode;
import com.cursorpoc.backend.whatsapp.WhatsAppOutboundMessage;
import com.cursorpoc.backend.whatsapp.WhatsAppOutbox;
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
      Boolean rollback) {}

  public record SendCodeRequest(String to, String code) {}

  private final FakeWhatsAppGateway gateway;
  private final WhatsAppMessageRepository messages;
  private final WhatsAppOutbox outbox;
  private final WhatsAppSender sender;
  private final TransactionTemplate tx;

  public WhatsAppTestSupportController(
      FakeWhatsAppGateway gateway,
      WhatsAppMessageRepository messages,
      WhatsAppOutbox outbox,
      WhatsAppSender sender,
      PlatformTransactionManager transactionManager) {
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
                        p.getTenantId(), null, null, "BOOKING", message, body.dedupKey());
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
    require(p);
    long tenantId = p.getTenantId();
    return messages.findAll().stream()
        .filter(m -> m.getTenantId() == tenantId)
        .map(
            m ->
                Map.<String, Object>of(
                    "id", m.getId(),
                    "purpose", m.getPurpose(),
                    "template", m.getTemplate(),
                    "status", m.getStatus(),
                    "errorCode", m.getErrorCode() == null ? "" : m.getErrorCode(),
                    "wamid", m.getMetaMessageId() == null ? "" : m.getMetaMessageId()))
        .toList();
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
