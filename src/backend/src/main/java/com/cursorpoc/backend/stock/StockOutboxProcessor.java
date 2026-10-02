package com.cursorpoc.backend.stock;

import com.cursorpoc.backend.config.StockProperties;
import com.cursorpoc.backend.domain.enums.StockOutboxStatus;
import com.cursorpoc.backend.security.CorrelationIdFilter;
import com.cursorpoc.backend.stock.StockApiClient.StockResponse;
import com.cursorpoc.backend.stock.StockApiClient.StockUnavailableException;
import com.cursorpoc.backend.stock.StockOutboxPersistenceService.Claim;
import com.cursorpoc.backend.stock.StockOutboxPersistenceService.ClaimOutcome;
import com.cursorpoc.backend.stock.StockOutboxPersistenceService.ClaimedEvent;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

/**
 * Stock integration (HU-60): delivers a tenant's pending outbox events to control-stock, oldest
 * first, one at a time. Each event is claimed with a lease ({@link
 * StockOutboxPersistenceService#claimNext}) so two wake-ups for the same tenant never send the same
 * event twice; control-stock's {@code Idempotency-Key} covers the rest (a retry after a lost
 * response replays instead of moving stock again). Runs on the Service Bus consumer thread (or the
 * local async queue in e2e/test) — never on a request thread.
 */
@Service
public class StockOutboxProcessor {

  private static final Logger log = LoggerFactory.getLogger(StockOutboxProcessor.class);

  /** Safety valve: a single wake-up never loops forever. */
  static final int MAX_EVENTS_PER_RUN = 500;

  static final int CATALOG_BATCH_SIZE = 500;

  private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {};

  private final StockOutboxPersistenceService persistence;
  private final StockApiClient client;
  private final StockPayloads payloads;
  private final StockProperties properties;
  private final ObjectMapper objectMapper;
  private Clock clock = Clock.systemUTC();

  public StockOutboxProcessor(
      StockOutboxPersistenceService persistence,
      StockApiClient client,
      StockPayloads payloads,
      StockProperties properties,
      ObjectMapper objectMapper) {
    this.persistence = persistence;
    this.client = client;
    this.payloads = payloads;
    this.properties = properties;
    this.objectMapper = objectMapper;
  }

  @Autowired(required = false)
  void setClock(Clock clock) {
    this.clock = clock;
  }

  /** Delivers everything that is due for this tenant; returns how many events were attempted. */
  public int processTenant(long tenantId, String correlationId) {
    String corr =
        correlationId == null || correlationId.isBlank()
            ? UUID.randomUUID().toString()
            : correlationId;
    MDC.put(CorrelationIdFilter.MDC_CORRELATION_ID, corr);
    MDC.put(CorrelationIdFilter.MDC_TENANT_ID, String.valueOf(tenantId));
    try {
      int attempted = 0;
      while (attempted < MAX_EVENTS_PER_RUN) {
        Claim claim = persistence.claimNext(tenantId, clock.instant());
        if (claim.outcome() != ClaimOutcome.CLAIMED) {
          if (claim.outcome() != ClaimOutcome.EMPTY) {
            log.info("Stock outbox tenantId={} stopped: {}", tenantId, claim.outcome());
          }
          break;
        }
        attempted++;
        if (!deliver(claim.event(), corr)) {
          // A failed delivery keeps the order: nothing behind it goes before its retry.
          break;
        }
      }
      return attempted;
    } finally {
      MDC.remove(CorrelationIdFilter.MDC_CORRELATION_ID);
      MDC.remove(CorrelationIdFilter.MDC_TENANT_ID);
    }
  }

  private boolean deliver(ClaimedEvent event, String correlationId) {
    if (!properties.isConfigured()) {
      persistence.markFailed(event.id(), "STOCK_NOT_CONFIGURED", true, clock.instant());
      log.warn("Stock outbox eventId={} not sent: STOCK_NOT_CONFIGURED", event.id());
      return false;
    }
    Outcome outcome;
    try {
      outcome = call(event, correlationId);
    } catch (StockUnavailableException e) {
      outcome = Outcome.failure(e.getMessage(), true);
    } catch (RuntimeException e) {
      log.error("Stock outbox eventId={} unexpected error", event.id(), e);
      outcome = Outcome.failure("UNEXPECTED_ERROR " + e.getClass().getSimpleName(), true);
    }
    if (outcome.success()) {
      persistence.markDone(event.id(), outcome.body(), clock.instant());
      log.info(
          "Stock outbox eventId={} type={} tenantId={} attempt={} status=DONE",
          event.id(),
          event.type(),
          event.tenantId(),
          event.attempt());
      return true;
    }
    StockOutboxStatus status =
        persistence.markFailed(event.id(), outcome.error(), outcome.retryable(), clock.instant());
    log.error(
        "Stock outbox eventId={} type={} tenantId={} attempt={} error={} status={}",
        event.id(),
        event.type(),
        event.tenantId(),
        event.attempt(),
        outcome.error(),
        status);
    return false;
  }

  private Outcome call(ClaimedEvent event, String correlationId) {
    long tenantId = event.tenantId();
    Map<String, Object> payload = readPayload(event.payloadJson());
    return switch (event.type()) {
      case TENANT_UPSERT -> evaluate(client.upsertTenant(tenantId, payload, correlationId));
      case FEATURE_FLAGS_SYNC ->
          evaluate(
              withProvisioning(
                  tenantId,
                  correlationId,
                  () -> client.pushFlags(tenantId, payload, correlationId)));
      case CATALOG_UPSERT ->
          evaluate(
              withProvisioning(
                  tenantId,
                  correlationId,
                  () ->
                      client.bulkUpsertItems(
                          tenantId, payload, event.idempotencyKey(), correlationId)));
      case CATALOG_FULL_SYNC -> fullCatalogSync(event, correlationId);
      case SALE ->
          evaluate(
              withProvisioning(
                  tenantId,
                  correlationId,
                  () ->
                      client.postDocument(
                          tenantId, payload, event.idempotencyKey(), correlationId)));
      case REVERSE -> {
        StockResponse response =
            withProvisioning(
                tenantId,
                correlationId,
                () ->
                    client.reverseDocument(
                        tenantId, payload, event.idempotencyKey(), correlationId));
        // Already reversed, or nothing was ever posted for that invoice (e.g. its sale was
        // discarded): either way there is nothing left to give back.
        if ("DOCUMENT_ALREADY_REVERSED".equals(response.errorCode())
            || "SOURCE_DOCUMENT_NOT_FOUND".equals(response.errorCode())) {
          yield Outcome.success(response.body());
        }
        yield evaluate(response);
      }
    };
  }

  private Outcome fullCatalogSync(ClaimedEvent event, String correlationId) {
    long tenantId = event.tenantId();
    List<Map<String, Object>> items = payloads.catalogItems(tenantId);
    List<String> bodies = new ArrayList<>();
    for (int from = 0, batch = 0; from < items.size(); from += CATALOG_BATCH_SIZE, batch++) {
      List<Map<String, Object>> slice =
          items.subList(from, Math.min(items.size(), from + CATALOG_BATCH_SIZE));
      // The body changes with the catalog, so every attempt and batch gets its own key; a bulk
      // upsert is naturally idempotent anyway.
      String key = event.idempotencyKey() + ":a" + event.attempt() + ":b" + batch;
      Map<String, Object> body = payloads.bulkUpsert(slice);
      StockResponse response =
          withProvisioning(
              tenantId,
              correlationId,
              () -> client.bulkUpsertItems(tenantId, body, key, correlationId));
      Outcome outcome = evaluate(response);
      if (!outcome.success()) {
        return outcome;
      }
      bodies.add(response.body());
    }
    return Outcome.success("{\"items\":" + items.size() + ",\"batches\":" + bodies.size() + "}");
  }

  /** {@code TENANT_NOT_PROVISIONED}: provision the tenant first, then retry the call once. */
  private StockResponse withProvisioning(
      long tenantId, String correlationId, Supplier<StockResponse> call) {
    StockResponse response = call.get();
    if (response.status() == 404 && "TENANT_NOT_PROVISIONED".equals(response.errorCode())) {
      log.info("Stock tenant {} not provisioned: provisioning before retrying", tenantId);
      StockResponse provisioned =
          client.upsertTenant(tenantId, payloads.tenantUpsert(tenantId), correlationId);
      if (!provisioned.isSuccess()) {
        return provisioned;
      }
      response = call.get();
    }
    return response;
  }

  private Map<String, Object> readPayload(String json) {
    if (json == null || json.isBlank()) {
      return Map.of();
    }
    return objectMapper.readValue(json, MAP_TYPE);
  }

  static Outcome evaluate(StockResponse response) {
    if (response.isSuccess()) {
      return Outcome.success(response.body());
    }
    String error =
        "HTTP_"
            + response.status()
            + (response.errorCode() != null ? " " + response.errorCode() : "");
    return Outcome.failure(error, isRetryable(response.status()));
  }

  /**
   * Network errors, 5xx, throttling and auth problems (fixable by configuration) are retried; any
   * other 4xx means the request itself is wrong and goes straight to FAILED for a human to look at.
   */
  static boolean isRetryable(int status) {
    return status >= 500
        || status == 401
        || status == 403
        || status == 404
        || status == 408
        || status == 429;
  }

  record Outcome(boolean success, String body, String error, boolean retryable) {
    static Outcome success(String body) {
      return new Outcome(true, body, null, false);
    }

    static Outcome failure(String error, boolean retryable) {
      return new Outcome(false, null, error, retryable);
    }
  }

  /** Visible for tests. */
  Instant now() {
    return clock.instant();
  }
}
