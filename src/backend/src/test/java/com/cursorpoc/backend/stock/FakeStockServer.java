package com.cursorpoc.backend.stock;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Minimal stand-in for control-stock's integration API (same paths, headers and error bodies as
 * control-stock's {@code IntegrationDtos}/{@code JsonErrorWriter}), for pelu's own tests — the
 * cross-system Playwright suite runs against the real thing.
 */
class FakeStockServer implements AutoCloseable {

  record Recorded(
      String method,
      String path,
      String tenantHeader,
      String idempotencyKey,
      String correlationId,
      String authorization,
      String body) {}

  private final HttpServer server;
  final List<Recorded> requests = new CopyOnWriteArrayList<>();
  final Set<String> provisionedTenants = ConcurrentHashMap.newKeySet();
  final Map<String, String> idempotentResponses = new ConcurrentHashMap<>();
  final AtomicInteger tokenRequests = new AtomicInteger();

  /** When > 0, the next N non-token calls answer this status (simulates Stock down). */
  volatile int failNextCalls;

  volatile int failStatus = 503;
  volatile String availabilityBody = "{\"items\":[]}";
  volatile boolean requireProvisioning = true;

  FakeStockServer() throws IOException {
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/", this::handle);
    server.start();
  }

  String baseUrl() {
    return "http://127.0.0.1:" + server.getAddress().getPort();
  }

  List<Recorded> calls(String pathPrefix) {
    return requests.stream().filter(r -> r.path().startsWith(pathPrefix)).toList();
  }

  private void handle(HttpExchange exchange) throws IOException {
    ByteArrayOutputStream bytes = new ByteArrayOutputStream();
    exchange.getRequestBody().transferTo(bytes);
    String body = bytes.toString(StandardCharsets.UTF_8);
    String path = exchange.getRequestURI().getRawPath();
    String query = exchange.getRequestURI().getRawQuery();
    String method = exchange.getRequestMethod();
    if (path.equals("/oauth/token")) {
      tokenRequests.incrementAndGet();
      if (!body.contains("client_secret=test-secret")) {
        respond(exchange, 401, "{\"error\":\"INVALID_CLIENT\"}");
        return;
      }
      respond(
          exchange,
          200,
          "{\"access_token\":\"tok-" + tokenRequests.get() + "\",\"expires_in\":3600}");
      return;
    }
    Recorded rec =
        new Recorded(
            method,
            path + (query != null ? "?" + query : ""),
            exchange.getRequestHeaders().getFirst("X-Tenant-Id"),
            exchange.getRequestHeaders().getFirst("Idempotency-Key"),
            exchange.getRequestHeaders().getFirst("X-Correlation-Id"),
            exchange.getRequestHeaders().getFirst("Authorization"),
            body);
    requests.add(rec);
    if (failNextCalls > 0) {
      failNextCalls--;
      respond(exchange, failStatus, "{\"error\":\"UNAVAILABLE\"}");
      return;
    }
    String prefix = "/api/v1/integration";
    if (path.startsWith(prefix + "/tenants/") && path.endsWith("/feature-flags")) {
      String tenant = path.substring((prefix + "/tenants/").length(), path.lastIndexOf('/'));
      if (requireProvisioning && !provisionedTenants.contains(tenant)) {
        respond(exchange, 404, "{\"error\":\"TENANT_NOT_PROVISIONED\"}");
        return;
      }
      respond(exchange, 204, "");
      return;
    }
    if (path.startsWith(prefix + "/tenants/")) {
      String tenant = path.substring((prefix + "/tenants/").length());
      boolean created = provisionedTenants.add(tenant);
      respond(
          exchange,
          created ? 201 : 200,
          "{\"id\":1,\"externalId\":\"" + tenant + "\",\"created\":" + created + "}");
      return;
    }
    String tenant = rec.tenantHeader();
    if (requireProvisioning && (tenant == null || !provisionedTenants.contains(tenant))) {
      respond(exchange, 404, "{\"error\":\"TENANT_NOT_PROVISIONED\"}");
      return;
    }
    if (path.equals(prefix + "/availability")) {
      respond(exchange, 200, availabilityBody);
      return;
    }
    String key = rec.idempotencyKey();
    if (key != null && idempotentResponses.containsKey(key)) {
      exchange.getResponseHeaders().add("Idempotent-Replayed", "true");
      respond(exchange, 200, idempotentResponses.get(key));
      return;
    }
    String response =
        switch (path.substring(prefix.length())) {
          case "/items:bulk-upsert" -> "{\"created\":1,\"updated\":0,\"skipped\":0,\"results\":[]}";
          case "/documents" ->
              "{\"documentId\":10,\"number\":\"SAL-0000001\",\"status\":\"CONFIRMED\","
                  + "\"lines\":[],\"warnings\":[{\"code\":\"NEGATIVE_STOCK\",\"itemId\":1,"
                  + "\"locationId\":1,\"balance\":-1}]}";
          case "/documents:reverse" -> "{\"reversalDocumentId\":11,\"status\":\"REVERSED\"}";
          default -> null;
        };
    if (response == null) {
      respond(exchange, 404, "{\"error\":\"NOT_FOUND\"}");
      return;
    }
    if (key != null) {
      idempotentResponses.put(key, response);
    }
    respond(exchange, path.endsWith("/documents") ? 201 : 200, response);
  }

  private static void respond(HttpExchange exchange, int status, String body) throws IOException {
    byte[] out = body.getBytes(StandardCharsets.UTF_8);
    exchange.getResponseHeaders().add("Content-Type", "application/json");
    if (status == 204) {
      exchange.sendResponseHeaders(204, -1);
    } else {
      exchange.sendResponseHeaders(status, out.length);
      exchange.getResponseBody().write(out);
    }
    exchange.close();
  }

  @Override
  public void close() {
    server.stop(0);
  }
}
