package com.cursorpoc.backend.web;

import com.cursorpoc.backend.domain.PlatformAlert;
import com.cursorpoc.backend.domain.WhatsAppTemplateStatus;
import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.whatsapp.PlatformAlertService;
import com.cursorpoc.backend.whatsapp.WhatsAppErrorCode;
import com.cursorpoc.backend.whatsapp.WhatsAppSendException;
import com.cursorpoc.backend.whatsapp.WhatsAppSender;
import com.cursorpoc.backend.whatsapp.WhatsAppSettings;
import com.cursorpoc.backend.whatsapp.WhatsAppTemplate;
import com.cursorpoc.backend.whatsapp.WhatsAppTemplateStatusService;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * HU-WAP-01/02: Platform Admin view of the shared WhatsApp channel — configuration state, the
 * template catalog with Meta's approval status, open alerts, and a test send. Never exposes a
 * secret value, only which ones are missing.
 */
@RestController
public class PlatformWhatsAppController {

  private static final Logger log = LoggerFactory.getLogger(PlatformWhatsAppController.class);

  public record TemplateRow(
      String name,
      String language,
      String category,
      int bodyVariables,
      int buttons,
      String bodyText,
      String status,
      String reason,
      Instant checkedAt) {}

  public record AlertRow(
      Long id, String category, String subject, String detail, Instant createdAt) {}

  public record StatusResponse(
      boolean enabled,
      String provider,
      boolean operational,
      List<String> configurationProblems,
      String apiVersion,
      List<TemplateRow> templates,
      List<AlertRow> alerts) {}

  public record TestSendRequest(String to, String template) {}

  public record TestSendResponse(String wamid) {}

  private final WhatsAppSettings settings;
  private final WhatsAppTemplateStatusService templateStatus;
  private final PlatformAlertService alerts;
  private final WhatsAppSender sender;

  public PlatformWhatsAppController(
      WhatsAppSettings settings,
      WhatsAppTemplateStatusService templateStatus,
      PlatformAlertService alerts,
      WhatsAppSender sender) {
    this.settings = settings;
    this.templateStatus = templateStatus;
    this.alerts = alerts;
    this.sender = sender;
  }

  @GetMapping("/api/platform/whatsapp/status")
  public StatusResponse status(@AuthenticationPrincipal FemmeUserPrincipal principal) {
    return run(principal, "GET /api/platform/whatsapp/status", this::buildStatus);
  }

  /** Asks Meta for the current template statuses (HU-WAP-02, criterio 2). */
  @PostMapping("/api/platform/whatsapp/templates/refresh")
  public StatusResponse refresh(@AuthenticationPrincipal FemmeUserPrincipal principal) {
    return run(
        principal,
        "POST /api/platform/whatsapp/templates/refresh",
        () -> {
          templateStatus.refresh();
          return buildStatus();
        });
  }

  @PostMapping("/api/platform/whatsapp/test-send")
  public TestSendResponse testSend(
      @AuthenticationPrincipal FemmeUserPrincipal principal, @RequestBody TestSendRequest request) {
    return run(
        principal,
        "POST /api/platform/whatsapp/test-send",
        () -> {
          WhatsAppTemplate template =
              request == null || request.template() == null
                  ? null
                  : WhatsAppTemplate.byName(request.template());
          if (template == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "WHATSAPP_UNKNOWN_TEMPLATE");
          }
          try {
            return new TestSendResponse(sender.sendPlatformTest(request.to(), template).wamid());
          } catch (WhatsAppSendException ex) {
            throw toHttp(ex);
          }
        });
  }

  @PostMapping("/api/platform/whatsapp/alerts/{id}/acknowledge")
  public StatusResponse acknowledge(
      @AuthenticationPrincipal FemmeUserPrincipal principal, @PathVariable("id") long id) {
    return run(
        principal,
        "POST /api/platform/whatsapp/alerts/{id}/acknowledge",
        () -> {
          alerts.acknowledge(id);
          return buildStatus();
        });
  }

  private StatusResponse buildStatus() {
    Map<String, WhatsAppTemplateStatus> byName = new java.util.HashMap<>();
    for (WhatsAppTemplateStatus s : templateStatus.all()) {
      byName.put(s.getTemplateName(), s);
    }
    List<TemplateRow> rows =
        java.util.Arrays.stream(WhatsAppTemplate.values())
            .map(
                t -> {
                  WhatsAppTemplateStatus s = byName.get(t.templateName());
                  return new TemplateRow(
                      t.templateName(),
                      WhatsAppTemplate.LANGUAGE,
                      t.category().name(),
                      t.bodyVariables(),
                      t.buttons().size(),
                      t.bodyText(),
                      s == null ? "UNKNOWN" : s.getStatus(),
                      s == null ? null : s.getReason(),
                      s == null ? null : s.getCheckedAt());
                })
            .toList();
    List<AlertRow> alertRows =
        alerts.listOpen().stream()
            .map(
                (PlatformAlert a) ->
                    new AlertRow(
                        a.getId(),
                        a.getCategory(),
                        a.getSubject(),
                        a.getDetail(),
                        a.getCreatedAt()))
            .toList();
    return new StatusResponse(
        settings.isEnabled(),
        settings.getProvider(),
        settings.isOperational(),
        settings.configurationProblems(),
        settings.getApiVersion(),
        rows,
        alertRows);
  }

  static ResponseStatusException toHttp(WhatsAppSendException ex) {
    HttpStatus status =
        ex.getCode() == WhatsAppErrorCode.INVALID_REQUEST
                || ex.getCode() == WhatsAppErrorCode.INVALID_RECIPIENT
            ? HttpStatus.BAD_REQUEST
            : HttpStatus.CONFLICT;
    return new ResponseStatusException(status, ex.getCode().apiError());
  }

  private static <T> T run(FemmeUserPrincipal principal, String route, Supplier<T> action) {
    if (principal == null) {
      log.error("{} tenantId=n/a status=401", route);
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    if (principal.getRole() != UserRole.PLATFORM_ADMIN) {
      log.error("{} tenantId=n/a status=403 role={}", route, principal.getRole());
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "FORBIDDEN");
    }
    log.info("{} tenantId=n/a adminUserId={}", route, principal.getUserId());
    try {
      T result = action.get();
      log.info("{} tenantId=n/a status=200", route);
      return result;
    } catch (WhatsAppSendException ex) {
      ResponseStatusException http = toHttp(ex);
      log.error(
          "{} tenantId=n/a status={} error={}",
          route,
          http.getStatusCode().value(),
          http.getReason());
      throw http;
    } catch (ResponseStatusException ex) {
      log.error(
          "{} tenantId=n/a status={} error={}", route, ex.getStatusCode().value(), ex.getReason());
      throw ex;
    }
  }
}
