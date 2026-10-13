package com.cursorpoc.backend.stock;

import com.cursorpoc.backend.config.StockProperties;
import com.cursorpoc.backend.domain.StockOutboxEvent;
import com.cursorpoc.backend.domain.StockTenantLink;
import com.cursorpoc.backend.domain.enums.StockEventType;
import com.cursorpoc.backend.domain.enums.StockOutboxStatus;
import com.cursorpoc.backend.repository.StockOutboxEventRepository;
import com.cursorpoc.backend.repository.StockTenantLinkRepository;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Stock integration (HU-60): the short transactions around one delivery attempt — claim (lease),
 * success, failure — kept in their own bean so {@code @Transactional} actually applies (same reason
 * as {@code SifenInvoiceSubmissionPersistenceService}). The network call to control-stock happens
 * between them, outside any transaction.
 */
@Service
public class StockOutboxPersistenceService {

  static final List<StockOutboxStatus> OPEN_STATUSES =
      List.of(StockOutboxStatus.PENDING, StockOutboxStatus.PROCESSING, StockOutboxStatus.FAILED);

  private static final int MAX_ERROR_LENGTH = 2000;

  private final StockOutboxEventRepository repository;
  private final StockTenantLinkRepository linkRepository;
  private final StockProperties properties;
  private final StockOutboxMessages messages;
  private final ObjectMapper objectMapper;

  public StockOutboxPersistenceService(
      StockOutboxEventRepository repository,
      StockTenantLinkRepository linkRepository,
      StockProperties properties,
      StockOutboxMessages messages,
      ObjectMapper objectMapper) {
    this.repository = repository;
    this.linkRepository = linkRepository;
    this.properties = properties;
    this.messages = messages;
    this.objectMapper = objectMapper;
  }

  /** What the worker needs to deliver one event, detached from the persistence context. */
  public record ClaimedEvent(
      long id,
      long tenantId,
      StockEventType type,
      String payloadJson,
      String idempotencyKey,
      int attempt) {}

  /** Why {@link #claimNext} returned nothing — logged by the worker. */
  public enum ClaimOutcome {
    CLAIMED,
    EMPTY,
    BLOCKED_BY_FAILED,
    LEASE_HELD,
    NOT_DUE
  }

  public record Claim(ClaimOutcome outcome, ClaimedEvent event) {}

  /**
   * Claims the tenant's queue head under a row lock — never an event behind it, so delivery order
   * per tenant is kept (sale before its reversal). A FAILED head blocks the tenant's queue; a head
   * whose lease is still held by another worker, or whose next attempt is not due yet, stops this
   * worker without skipping ahead.
   *
   * <p>One exception to "never skip": a full catalog sync replaces every earlier one (it sends the
   * whole catalog as it is now), so a head full sync that has a newer one queued is discarded as
   * {@code SUPERSEDED} instead of holding the queue — a stuck old sync no longer blocks the sales
   * behind it.
   */
  @Transactional
  public Claim claimNext(long tenantId, Instant now) {
    while (true) {
      Optional<StockOutboxEvent> head =
          repository.findFirstByTenantIdAndStatusInOrderByIdAsc(tenantId, OPEN_STATUSES);
      if (head.isEmpty()) {
        return new Claim(ClaimOutcome.EMPTY, null);
      }
      StockOutboxEvent event = repository.lockById(head.get().getId()).orElse(null);
      if (event == null || !OPEN_STATUSES.contains(event.getStatus())) {
        // DONE/DISCARDED changed under us between the read and the lock: look again next time.
        return new Claim(ClaimOutcome.EMPTY, null);
      }
      if (supersedeIfReplaced(event, now)) {
        continue;
      }
      boolean reclaimedExpiredLease = false;
      switch (event.getStatus()) {
        case FAILED -> {
          return new Claim(ClaimOutcome.BLOCKED_BY_FAILED, null);
        }
        case PROCESSING -> {
          Instant started = event.getProcessingStartedAt();
          if (started != null && started.isAfter(now.minus(properties.getLeaseTtl()))) {
            return new Claim(ClaimOutcome.LEASE_HELD, null);
          }
          reclaimedExpiredLease = true;
        }
        case PENDING -> {
          if (event.getNextAttemptAt() != null && event.getNextAttemptAt().isAfter(now)) {
            return new Claim(ClaimOutcome.NOT_DUE, null);
          }
        }
        default -> {
          return new Claim(ClaimOutcome.EMPTY, null);
        }
      }
      int attempt = event.getAttemptCount() + 1;
      if (reclaimedExpiredLease) {
        messages.append(
            event,
            StockOutboxMessages.WARN,
            "LEASE_EXPIRED_RECLAIMED",
            StockOutboxMessages.params("attempt", event.getAttemptCount()),
            now);
      }
      event.setStatus(StockOutboxStatus.PROCESSING);
      event.setProcessingStartedAt(now);
      event.setAttemptCount(attempt);
      messages.append(
          event,
          StockOutboxMessages.INFO,
          "ATTEMPT_STARTED",
          StockOutboxMessages.params("attempt", attempt, "maxAttempts", maxAttempts()),
          now);
      return new Claim(
          ClaimOutcome.CLAIMED,
          new ClaimedEvent(
              event.getId(),
              event.getTenantId(),
              event.getEventType(),
              event.getPayloadJson(),
              event.getIdempotencyKey(),
              event.getAttemptCount()));
    }
  }

  /** True (and the event discarded) when {@code event} is a full catalog sync with a newer one. */
  private boolean supersedeIfReplaced(StockOutboxEvent event, Instant now) {
    if (event.getEventType() != StockEventType.CATALOG_FULL_SYNC) {
      return false;
    }
    if (event.getStatus() == StockOutboxStatus.PROCESSING
        && event.getProcessingStartedAt() != null
        && event.getProcessingStartedAt().isAfter(now.minus(properties.getLeaseTtl()))) {
      return false; // another worker is mid-call with it
    }
    Optional<StockOutboxEvent> newer =
        repository.findFirstByTenantIdAndEventTypeAndStatusInAndIdGreaterThanOrderByIdDesc(
            event.getTenantId(), StockEventType.CATALOG_FULL_SYNC, OPEN_STATUSES, event.getId());
    if (newer.isEmpty()) {
      return false;
    }
    event.setStatus(StockOutboxStatus.DISCARDED);
    event.setDoneAt(now);
    event.setNextAttemptAt(null);
    event.setProcessingStartedAt(null);
    messages.append(
        event,
        StockOutboxMessages.INFO,
        "SUPERSEDED",
        StockOutboxMessages.params("byEventId", newer.get().getId()),
        now);
    return true;
  }

  /** Number of delivery attempts an event gets before it is marked FAILED. */
  int maxAttempts() {
    return properties.getRetryDelays().size() + 1;
  }

  /**
   * Keeps a long delivery (a catalog sync in several batches) from losing its lease to another
   * worker between batches.
   */
  @Transactional
  public void renewLease(long eventId, Instant now) {
    repository
        .findById(eventId)
        .filter(e -> e.getStatus() == StockOutboxStatus.PROCESSING)
        .ifPresent(e -> e.setProcessingStartedAt(now));
  }

  @Transactional
  public void markDone(long eventId, String responseJson, Instant now) {
    StockOutboxEvent event = repository.findById(eventId).orElseThrow();
    event.setStatus(StockOutboxStatus.DONE);
    event.setDoneAt(now);
    event.setProcessingStartedAt(null);
    event.setNextAttemptAt(null);
    event.setLastError(null);
    event.setResponseJson(responseJson);
    messages.append(
        event,
        StockOutboxMessages.INFO,
        "DELIVERED",
        deliveredParams(event.getAttemptCount(), responseJson),
        now);
    StockTenantLink link = linkRepository.findById(event.getTenantId()).orElse(null);
    if (link != null) {
      if (event.getEventType() == StockEventType.TENANT_UPSERT) {
        link.setProvisionedAt(now);
      }
      if (event.getEventType() == StockEventType.CATALOG_FULL_SYNC) {
        link.setCatalogSyncedAt(now);
      }
      link.setLastError(null);
    }
  }

  /**
   * Schedules the next attempt with the configured backoff (1 m, 5 m, 15 m, 1 h, 4 h, 24 h); once
   * those are exhausted — or right away for a non-retryable error — the event becomes FAILED and
   * blocks the tenant's queue until a Platform Admin retries or discards it.
   */
  @Transactional
  public StockOutboxStatus markFailed(long eventId, String error, boolean retryable, Instant now) {
    StockOutboxEvent event = repository.findById(eventId).orElseThrow();
    String trimmed = truncate(error);
    event.setLastError(trimmed);
    event.setProcessingStartedAt(null);
    List<Duration> delays = properties.getRetryDelays();
    int attempt = event.getAttemptCount();
    String reason = StockOutboxMessages.reasonOf(error);
    if (retryable && attempt <= delays.size()) {
      Instant next = now.plus(delays.get(Math.max(0, attempt - 1)));
      event.setStatus(StockOutboxStatus.PENDING);
      event.setNextAttemptAt(next);
      messages.append(
          event,
          StockOutboxMessages.WARN,
          "ATTEMPT_FAILED_RETRY_SCHEDULED",
          StockOutboxMessages.params(
              "attempt",
              attempt,
              "maxAttempts",
              maxAttempts(),
              "reason",
              reason,
              "detail",
              trimmed,
              "nextAttemptAt",
              next.toString()),
          now);
    } else {
      event.setStatus(StockOutboxStatus.FAILED);
      event.setNextAttemptAt(null);
      messages.append(
          event,
          StockOutboxMessages.ERROR,
          retryable ? "ATTEMPT_FAILED_NO_MORE_RETRIES" : "ATTEMPT_FAILED_NOT_RETRYABLE",
          StockOutboxMessages.params(
              "attempt",
              attempt,
              "maxAttempts",
              maxAttempts(),
              "reason",
              reason,
              "detail",
              trimmed),
          now);
    }
    linkRepository.findById(event.getTenantId()).ifPresent(l -> l.setLastError(trimmed));
    return event.getStatus();
  }

  /** Releases a lease without counting it as an attempt (e.g. the app is shutting down). */
  @Transactional
  public void release(long eventId) {
    repository
        .findById(eventId)
        .filter(e -> e.getStatus() == StockOutboxStatus.PROCESSING)
        .ifPresent(
            e -> {
              e.setStatus(StockOutboxStatus.PENDING);
              e.setProcessingStartedAt(null);
              e.setAttemptCount(Math.max(0, e.getAttemptCount() - 1));
              messages.append(e, StockOutboxMessages.INFO, "ATTEMPT_RELEASED", Instant.now());
            });
  }

  /** {@code attempt}, plus the item/batch counts a full catalog sync reports in its response. */
  private Map<String, Object> deliveredParams(int attempt, String responseJson) {
    Integer items = null;
    Integer batches = null;
    if (responseJson != null && responseJson.startsWith("{\"items\"")) {
      try {
        JsonNode node = objectMapper.readTree(responseJson);
        items = node.path("items").isNumber() ? node.path("items").asInt() : null;
        batches = node.path("batches").isNumber() ? node.path("batches").asInt() : null;
      } catch (RuntimeException e) {
        // Counts are decoration only.
      }
    }
    return StockOutboxMessages.params("attempt", attempt, "items", items, "batches", batches);
  }

  private static String truncate(String value) {
    if (value == null) {
      return null;
    }
    return value.length() <= MAX_ERROR_LENGTH ? value : value.substring(0, MAX_ERROR_LENGTH);
  }
}
