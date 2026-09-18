package com.cursorpoc.backend.service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

/**
 * Issue #224: base integration with Meta's WhatsApp Cloud API (direct, no BSP — Twilio was
 * evaluated and rejected, see the decision doc). Sends WhatsApp Business template messages via
 * {@code POST https://graph.facebook.com/v{version}/{phone-number-id}/messages} using the plain JDK
 * {@link HttpClient}, the same outbound-HTTP tool {@link SifenEventClient} and friends already use
 * for SIFEN — Meta's Graph API is plain JSON/HTTPS with a bearer token, so none of the mTLS
 * machinery those clients need applies here.
 *
 * <p>Credential resolution mirrors {@link EmailService}/Azure Communication Email exactly: real
 * values come from environment variables ({@code WHATSAPP_ACCESS_TOKEN}, {@code
 * WHATSAPP_PHONE_NUMBER_ID}, {@code WHATSAPP_ENABLED}), Terraform-injected in every real deployment
 * (see {@code run-local-azure-dev.sh} / CLAUDE.md for the equivalent {@code ACS_CONNECTION_STRING}
 * recipe) — never hardcoded here. {@link #isEffectivelyEnabled()} treats "enabled but missing
 * credentials" (the local/e2e default) the same as disabled, falling back to a dev-log no-op
 * instead of reaching the real Graph API with blank credentials.
 *
 * <p>{@code baseUrl} is configurable ({@code app.femme.whatsapp.base-url}, default {@code
 * https://graph.facebook.com}) purely as a test seam — {@code WhatsAppServiceTest} points it at a
 * local mock HTTP server so the "HTTP call mocked" acceptance criterion holds without any real
 * network access or credentials.
 */
@Service
public class WhatsAppService {

  private static final Logger log = LoggerFactory.getLogger(WhatsAppService.class);

  private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(15);

  @Value("${app.femme.whatsapp.enabled:false}")
  private boolean enabled;

  @Value("${app.femme.whatsapp.access-token:}")
  private String accessToken;

  @Value("${app.femme.whatsapp.phone-number-id:}")
  private String phoneNumberId;

  @Value("${app.femme.whatsapp.api-version:v21.0}")
  private String apiVersion;

  @Value("${app.femme.whatsapp.base-url:https://graph.facebook.com}")
  private String baseUrl;

  private final ObjectMapper objectMapper;

  public WhatsAppService(ObjectMapper objectMapper) {
    this.objectMapper = objectMapper;
  }

  /**
   * Same rationale as {@link EmailService#isEffectivelyEnabled()}: {@code enabled=true} with a
   * blank access token or phone-number-id (the local/dev/e2e default, since neither has an env-var
   * value set) must not reach the real HTTP call — it would just fail with an
   * unauthenticated/malformed request. Treating that as disabled keeps it a silent dev-log fallback
   * instead of a confusing runtime failure.
   */
  private boolean isEffectivelyEnabled() {
    return enabled && !accessToken.isBlank() && !phoneNumberId.isBlank();
  }

  /**
   * Sends a WhatsApp Business template message to {@code toPhoneNumber} (E.164-ish, e.g. {@code
   * +595981234567}). {@code bodyParameters} fills the template's {@code {{1}}, {{2}}, ...}
   * placeholders in order, as plain-text parameters on the template's {@code BODY} component; pass
   * an empty list for a template with no placeholders.
   *
   * <p>Real sends log only the recipient, template name and HTTP status — not the parameter values,
   * which routinely carry client-identifying content (names, appointment times) — mirroring {@link
   * SifenEventClient}'s choice to log payload size rather than raw content for its request line.
   * The dev/disabled fallback below logs full parameter values, same as {@link EmailService}'s
   * dev-log fallback, since that path only ever runs against local/e2e config.
   */
  public void sendTemplateMessage(
      String toPhoneNumber, String templateName, String languageCode, List<String> bodyParameters) {
    if (!isEffectivelyEnabled()) {
      log.info(
          "WHATSAPP (dev) to={} template={} language={} params={}",
          toPhoneNumber,
          templateName,
          languageCode,
          bodyParameters);
      return;
    }

    Map<String, Object> requestBody =
        buildTemplateMessageBody(toPhoneNumber, templateName, languageCode, bodyParameters);
    String json;
    try {
      json = objectMapper.writeValueAsString(requestBody);
    } catch (Exception ex) {
      log.error(
          "WHATSAPP send failed to={} template={} error=could not serialize request body",
          toPhoneNumber,
          templateName,
          ex);
      throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "WHATSAPP_SEND_FAILED");
    }

    try {
      HttpClient client = HttpClient.newHttpClient();
      URI uri = URI.create(baseUrl + "/" + apiVersion + "/" + phoneNumberId + "/messages");
      HttpRequest request =
          HttpRequest.newBuilder(uri)
              .timeout(REQUEST_TIMEOUT)
              .header("Content-Type", "application/json")
              .header("Authorization", "Bearer " + accessToken)
              .POST(HttpRequest.BodyPublishers.ofString(json, StandardCharsets.UTF_8))
              .build();
      log.info("WHATSAPP req to={} template={}", toPhoneNumber, templateName);
      HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());

      if (response.statusCode() / 100 != 2) {
        log.error(
            "WHATSAPP send failed to={} template={} httpStatus={} body={}",
            toPhoneNumber,
            templateName,
            response.statusCode(),
            response.body());
        throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "WHATSAPP_SEND_FAILED");
      }
      log.info(
          "WHATSAPP SENT to={} template={} httpStatus={}",
          toPhoneNumber,
          templateName,
          response.statusCode());
    } catch (java.io.IOException | InterruptedException ex) {
      if (Thread.currentThread().isInterrupted()) {
        Thread.currentThread().interrupt();
      }
      log.error(
          "WHATSAPP send failed to={} template={} error={}",
          toPhoneNumber,
          templateName,
          ex.toString());
      throw new ResponseStatusException(
          HttpStatus.INTERNAL_SERVER_ERROR, "WHATSAPP_SEND_FAILED", ex);
    }
  }

  /**
   * Builds the {@code messages} request body per Meta's Cloud API template-message shape: {@code
   * messaging_product/to/type=template/template.name/template.language.code} plus an optional
   * {@code BODY} component carrying {@code bodyParameters} as ordered text parameters.
   */
  private static Map<String, Object> buildTemplateMessageBody(
      String toPhoneNumber, String templateName, String languageCode, List<String> bodyParameters) {
    Map<String, Object> template = new LinkedHashMap<>();
    template.put("name", templateName);
    template.put("language", Map.of("code", languageCode));
    if (bodyParameters != null && !bodyParameters.isEmpty()) {
      List<Map<String, String>> parameters =
          bodyParameters.stream().map(p -> Map.of("type", "text", "text", p)).toList();
      template.put("components", List.of(Map.of("type", "body", "parameters", parameters)));
    }

    Map<String, Object> body = new LinkedHashMap<>();
    body.put("messaging_product", "whatsapp");
    body.put("to", toPhoneNumber);
    body.put("type", "template");
    body.put("template", template);
    return body;
  }
}
