package com.cursorpoc.backend.whatsapp;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Meta's WhatsApp Cloud API, called directly (no intermediary). One {@link HttpClient} is built
 * once and reused (HU-WAP-01, criterio 9), with connect and response timeouts.
 *
 * <p>Logs carry only the masked recipient, the template and the outcome — never the variables
 * (RT-13). The error response is read for its numeric code only; Meta's free text is not logged.
 *
 * <p>NOT VERIFIED against Meta's current documentation (the docs host was unreachable from the
 * build environment): the JSON field names, the error-code classification in {@link #classify(int,
 * Integer)} and the template-listing fields follow the API as known for {@code v21.0}. Contrast
 * them before enabling a salon, as HU-WAP-01 §11 asks.
 */
@Component
@ConditionalOnProperty(
    name = "app.femme.whatsapp.provider",
    havingValue = WhatsAppSettings.PROVIDER_META,
    matchIfMissing = true)
public class MetaCloudWhatsAppGateway implements WhatsAppGateway {

  private static final Logger log = LoggerFactory.getLogger(MetaCloudWhatsAppGateway.class);

  private final WhatsAppSettings settings;
  private final ObjectMapper objectMapper;
  private final HttpClient client;

  public MetaCloudWhatsAppGateway(WhatsAppSettings settings, ObjectMapper objectMapper) {
    this.settings = settings;
    this.objectMapper = objectMapper;
    this.client =
        HttpClient.newBuilder()
            .connectTimeout(Duration.ofMillis(settings.getConnectTimeoutMs()))
            .build();
  }

  @Override
  public WhatsAppSendResult send(WhatsAppOutboundMessage message, Duration timeout) {
    if (!settings.isOperational()) {
      throw new WhatsAppSendException(WhatsAppErrorCode.CHANNEL_UNAVAILABLE);
    }
    String json;
    try {
      json = objectMapper.writeValueAsString(buildBody(message));
    } catch (RuntimeException ex) {
      throw new WhatsAppSendException(WhatsAppErrorCode.INVALID_REQUEST, null, ex);
    }
    URI uri =
        URI.create(
            settings.getBaseUrl()
                + "/"
                + settings.getApiVersion()
                + "/"
                + settings.getPhoneNumberId()
                + "/messages");
    HttpRequest request =
        HttpRequest.newBuilder(uri)
            .timeout(timeout)
            .header("Content-Type", "application/json")
            .header("Authorization", "Bearer " + settings.getAccessToken())
            .POST(HttpRequest.BodyPublishers.ofString(json, StandardCharsets.UTF_8))
            .build();
    HttpResponse<String> response = execute(request);
    if (response.statusCode() / 100 != 2) {
      WhatsAppSendException ex = toException(response);
      log.error(
          "WHATSAPP send failed template={} httpStatus={} error={}",
          message.templateName(),
          response.statusCode(),
          ex.getMessage());
      throw ex;
    }
    String wamid = readWamid(response.body());
    log.info(
        "WHATSAPP SENT template={} httpStatus={}", message.templateName(), response.statusCode());
    return new WhatsAppSendResult(wamid);
  }

  @Override
  public List<WhatsAppRemoteTemplate> listTemplates() {
    if (!settings.isOperational()) {
      throw new WhatsAppSendException(WhatsAppErrorCode.CHANNEL_UNAVAILABLE);
    }
    List<WhatsAppRemoteTemplate> out = new ArrayList<>();
    String url =
        settings.getBaseUrl()
            + "/"
            + settings.getApiVersion()
            + "/"
            + settings.getBusinessAccountId()
            + "/message_templates?fields="
            + URLEncoder.encode(
                "name,language,status,category,rejected_reason", StandardCharsets.UTF_8)
            + "&limit=100";
    int pages = 0;
    while (url != null && pages++ < 10) {
      HttpRequest request =
          HttpRequest.newBuilder(URI.create(url))
              .timeout(Duration.ofMillis(settings.getRequestTimeoutMs()))
              .header("Authorization", "Bearer " + settings.getAccessToken())
              .GET()
              .build();
      HttpResponse<String> response = execute(request);
      if (response.statusCode() / 100 != 2) {
        throw toException(response);
      }
      JsonNode root;
      try {
        root = objectMapper.readTree(response.body());
      } catch (RuntimeException ex) {
        throw new WhatsAppSendException(WhatsAppErrorCode.TRANSIENT, null, ex);
      }
      for (JsonNode t : root.path("data")) {
        String reason = t.path("rejected_reason").asString();
        out.add(
            new WhatsAppRemoteTemplate(
                t.path("name").asString(),
                t.path("language").asString(),
                t.path("status").asString(),
                t.path("category").asString(),
                reason == null || reason.isBlank() || "NONE".equals(reason) ? null : reason));
      }
      String next = root.path("paging").path("next").asString();
      url = next == null || next.isBlank() ? null : next;
    }
    return out;
  }

  private HttpResponse<String> execute(HttpRequest request) {
    try {
      return client.send(request, HttpResponse.BodyHandlers.ofString());
    } catch (IOException ex) {
      throw new WhatsAppSendException(WhatsAppErrorCode.TRANSIENT, null, ex);
    } catch (InterruptedException ex) {
      Thread.currentThread().interrupt();
      throw new WhatsAppSendException(WhatsAppErrorCode.TRANSIENT, null, ex);
    }
  }

  /**
   * The {@code messages} request body for a template message (body, URL and quick-reply buttons).
   */
  static Map<String, Object> buildBody(WhatsAppOutboundMessage m) {
    List<Map<String, Object>> components = new ArrayList<>();
    if (!m.bodyParameters().isEmpty()) {
      components.add(
          Map.of(
              "type",
              "body",
              "parameters",
              m.bodyParameters().stream().map(p -> Map.of("type", "text", "text", p)).toList()));
    }
    for (WhatsAppButton b : m.buttons()) {
      Map<String, Object> component = new LinkedHashMap<>();
      component.put("type", "button");
      component.put("sub_type", b.kind() == WhatsAppButton.Kind.URL ? "url" : "quick_reply");
      component.put("index", String.valueOf(b.index()));
      component.put(
          "parameters",
          List.of(
              b.kind() == WhatsAppButton.Kind.URL
                  ? Map.of("type", "text", "text", b.value())
                  : Map.of("type", "payload", "payload", b.value())));
      components.add(component);
    }
    Map<String, Object> template = new LinkedHashMap<>();
    template.put("name", m.templateName());
    template.put("language", Map.of("code", m.languageCode()));
    if (!components.isEmpty()) {
      template.put("components", components);
    }
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("messaging_product", "whatsapp");
    body.put("to", m.to());
    body.put("type", "template");
    body.put("template", template);
    return body;
  }

  private String readWamid(String body) {
    try {
      String id = objectMapper.readTree(body).path("messages").path(0).path("id").asString();
      if (id == null || id.isBlank()) {
        throw new WhatsAppSendException(WhatsAppErrorCode.TRANSIENT);
      }
      return id;
    } catch (WhatsAppSendException ex) {
      throw ex;
    } catch (RuntimeException ex) {
      throw new WhatsAppSendException(WhatsAppErrorCode.TRANSIENT, null, ex);
    }
  }

  private WhatsAppSendException toException(HttpResponse<String> response) {
    Integer metaCode = null;
    try {
      JsonNode code = objectMapper.readTree(response.body()).path("error").path("code");
      if (code.isNumber()) {
        metaCode = code.asInt();
      }
    } catch (RuntimeException ignored) {
      // Not JSON (a proxy page, an outage): classified by HTTP status alone.
    }
    return new WhatsAppSendException(classify(response.statusCode(), metaCode), metaCode);
  }

  /** Maps Meta's HTTP status and numeric error code to our categories. */
  static WhatsAppErrorCode classify(int httpStatus, Integer metaCode) {
    if (metaCode != null) {
      int c = metaCode;
      if (c == 190 || c == 10 || (c >= 200 && c <= 299)) {
        return WhatsAppErrorCode.AUTH_FAILED;
      }
      if (c == 131026 || c == 131030 || c == 131021) {
        return WhatsAppErrorCode.INVALID_RECIPIENT;
      }
      if (c == 132001 || c == 132015 || c == 132016) {
        return WhatsAppErrorCode.TEMPLATE_UNAVAILABLE;
      }
      if (c == 132000 || c == 132005 || c == 132007 || c == 132012) {
        return WhatsAppErrorCode.INVALID_REQUEST;
      }
      if (c == 130429
          || c == 131048
          || c == 131056
          || c == 80007
          || c == 4
          || c == 17
          || c == 613) {
        return WhatsAppErrorCode.RATE_LIMITED;
      }
      if (c == 131000 || c == 131016 || c == 131057 || c == 1 || c == 2) {
        return WhatsAppErrorCode.TRANSIENT;
      }
    }
    if (httpStatus == 401 || httpStatus == 403) {
      return WhatsAppErrorCode.AUTH_FAILED;
    }
    if (httpStatus == 429) {
      return WhatsAppErrorCode.RATE_LIMITED;
    }
    if (httpStatus >= 500) {
      return WhatsAppErrorCode.TRANSIENT;
    }
    return WhatsAppErrorCode.INVALID_REQUEST;
  }
}
