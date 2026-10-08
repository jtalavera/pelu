package com.cursorpoc.backend.stock;

import com.cursorpoc.backend.config.StockProperties;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Stock integration (HU-60): thin HTTP client for control-stock's integration API, built on {@link
 * HttpClient} like {@code WhatsAppService}. Obtains (and caches) an OAuth2 {@code
 * client_credentials} token and sends the integration headers ({@code X-Tenant-Id} = pelu's tenant
 * id, {@code Idempotency-Key}, {@code X-Correlation-Id}). Never throws for HTTP errors: callers get
 * a {@link StockResponse} and decide whether it is retryable; network failures surface as {@link
 * StockUnavailableException}.
 */
@Component
public class StockApiClient {

  private static final Logger log = LoggerFactory.getLogger(StockApiClient.class);

  static final String API_PREFIX = "/api/v1/integration";

  private final StockProperties properties;
  private final ObjectMapper objectMapper;
  private final HttpClient httpClient;

  private volatile String accessToken;
  private volatile Instant accessTokenExpiry = Instant.EPOCH;

  public StockApiClient(StockProperties properties, ObjectMapper objectMapper) {
    this.properties = properties;
    this.objectMapper = objectMapper;
    this.httpClient = HttpClient.newBuilder().connectTimeout(properties.getHttpTimeout()).build();
  }

  /** Result of one call: HTTP status, raw body and the parsed {@code error} code, if any. */
  public record StockResponse(int status, String body, String errorCode) {
    public boolean isSuccess() {
      return status >= 200 && status < 300;
    }
  }

  /** Network-level failure (connection refused, timeout…) — always retryable. */
  public static class StockUnavailableException extends RuntimeException {
    public StockUnavailableException(String message, Throwable cause) {
      super(message, cause);
    }
  }

  public StockResponse upsertTenant(long tenantId, Map<String, Object> body, String correlationId) {
    return send("PUT", "/tenants/" + tenantId, body, null, null, correlationId);
  }

  public StockResponse pushFlags(long tenantId, Map<String, Object> body, String correlationId) {
    return send("PUT", "/tenants/" + tenantId + "/feature-flags", body, null, null, correlationId);
  }

  public StockResponse bulkUpsertItems(
      long tenantId, Map<String, Object> body, String idempotencyKey, String correlationId) {
    return send(
        "POST",
        "/items:bulk-upsert",
        body,
        String.valueOf(tenantId),
        idempotencyKey,
        correlationId,
        properties.getBulkHttpTimeout());
  }

  public StockResponse postDocument(
      long tenantId, Map<String, Object> body, String idempotencyKey, String correlationId) {
    return send(
        "POST", "/documents", body, String.valueOf(tenantId), idempotencyKey, correlationId);
  }

  public StockResponse reverseDocument(
      long tenantId, Map<String, Object> body, String idempotencyKey, String correlationId) {
    return send(
        "POST",
        "/documents:reverse",
        body,
        String.valueOf(tenantId),
        idempotencyKey,
        correlationId);
  }

  public StockResponse availability(
      long tenantId, String externalType, Iterable<String> externalIds, String correlationId) {
    String ids = String.join(",", externalIds);
    String query =
        "?sourceSystem="
            + encode(properties.getSourceSystem())
            + "&externalType="
            + encode(externalType)
            + "&externalIds="
            + encode(ids);
    return send(
        "GET", "/availability" + query, null, String.valueOf(tenantId), null, correlationId);
  }

  public JsonNode parse(String body) {
    if (body == null || body.isBlank()) {
      return objectMapper.nullNode();
    }
    return objectMapper.readTree(body);
  }

  private StockResponse send(
      String method,
      String path,
      Object body,
      String tenantHeader,
      String idempotencyKey,
      String correlationId) {
    return send(
        method,
        path,
        body,
        tenantHeader,
        idempotencyKey,
        correlationId,
        properties.getHttpTimeout());
  }

  private StockResponse send(
      String method,
      String path,
      Object body,
      String tenantHeader,
      String idempotencyKey,
      String correlationId,
      Duration timeout) {
    StockResponse response =
        sendOnce(method, path, body, tenantHeader, idempotencyKey, correlationId, timeout);
    if (response.status() == 401) {
      // Cached token expired or was revoked: get a fresh one and try exactly once more.
      invalidateToken();
      response = sendOnce(method, path, body, tenantHeader, idempotencyKey, correlationId, timeout);
    }
    return response;
  }

  private StockResponse sendOnce(
      String method,
      String path,
      Object body,
      String tenantHeader,
      String idempotencyKey,
      String correlationId,
      Duration timeout) {
    URI uri = URI.create(baseUrl() + API_PREFIX + path);
    HttpRequest.Builder builder =
        HttpRequest.newBuilder(uri)
            .timeout(timeout)
            .header("Authorization", "Bearer " + token())
            .header("Accept", "application/json");
    if (tenantHeader != null) {
      builder.header("X-Tenant-Id", tenantHeader);
    }
    if (idempotencyKey != null) {
      builder.header("Idempotency-Key", idempotencyKey);
    }
    if (correlationId != null && !correlationId.isBlank()) {
      builder.header("X-Correlation-Id", correlationId);
    }
    if (body != null) {
      builder
          .header("Content-Type", "application/json")
          .method(
              method,
              HttpRequest.BodyPublishers.ofString(
                  objectMapper.writeValueAsString(body), StandardCharsets.UTF_8));
    } else {
      builder.method(method, HttpRequest.BodyPublishers.noBody());
    }
    HttpResponse<String> response = execute(builder.build());
    String errorCode = response.statusCode() >= 400 ? errorCode(response.body()) : null;
    if (response.statusCode() >= 400) {
      log.warn(
          "control-stock call {} {} tenant={} status={} error={}",
          method,
          path,
          tenantHeader,
          response.statusCode(),
          errorCode);
    }
    return new StockResponse(response.statusCode(), response.body(), errorCode);
  }

  private synchronized String token() {
    if (accessToken != null && Instant.now().isBefore(accessTokenExpiry)) {
      return accessToken;
    }
    Map<String, String> form = new LinkedHashMap<>();
    form.put("grant_type", "client_credentials");
    form.put("client_id", properties.getClientId());
    form.put("client_secret", properties.getClientSecret());
    String encoded =
        form.entrySet().stream()
            .map(e -> encode(e.getKey()) + "=" + encode(e.getValue() == null ? "" : e.getValue()))
            .collect(Collectors.joining("&"));
    HttpRequest request =
        HttpRequest.newBuilder(URI.create(baseUrl() + properties.getTokenPath()))
            .timeout(properties.getHttpTimeout())
            .header("Content-Type", "application/x-www-form-urlencoded")
            .header("Accept", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(encoded, StandardCharsets.UTF_8))
            .build();
    HttpResponse<String> response = execute(request);
    if (response.statusCode() != 200) {
      log.error(
          "control-stock token request failed status={} error={}",
          response.statusCode(),
          errorCode(response.body()));
      throw new StockUnavailableException(
          "STOCK_TOKEN_REQUEST_FAILED status=" + response.statusCode(), null);
    }
    JsonNode json = objectMapper.readTree(response.body());
    accessToken = json.path("access_token").asString();
    long expiresIn = json.path("expires_in").asLong(300);
    accessTokenExpiry = Instant.now().plusSeconds(Math.max(30, expiresIn - 60));
    return accessToken;
  }

  synchronized void invalidateToken() {
    accessToken = null;
    accessTokenExpiry = Instant.EPOCH;
  }

  private HttpResponse<String> execute(HttpRequest request) {
    try {
      return httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    } catch (IOException e) {
      throw new StockUnavailableException("STOCK_UNREACHABLE " + e.getClass().getSimpleName(), e);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new StockUnavailableException("STOCK_CALL_INTERRUPTED", e);
    }
  }

  private String errorCode(String body) {
    if (body == null || body.isBlank()) {
      return null;
    }
    try {
      JsonNode node = objectMapper.readTree(body);
      JsonNode error = node.path("error");
      return error.isMissingNode() || error.isNull() ? null : error.asString();
    } catch (RuntimeException e) {
      return null;
    }
  }

  private String baseUrl() {
    String base = properties.getBaseUrl();
    if (base == null || base.isBlank()) {
      throw new StockUnavailableException("STOCK_NOT_CONFIGURED", null);
    }
    return base.endsWith("/") ? base.substring(0, base.length() - 1) : base;
  }

  private static String encode(String value) {
    return URLEncoder.encode(value, StandardCharsets.UTF_8);
  }
}
