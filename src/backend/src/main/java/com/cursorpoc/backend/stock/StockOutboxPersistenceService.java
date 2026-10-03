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
import java.util.Optional;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

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

  public StockOutboxPersistenceService(
      StockOutboxEventRepository repository,
      StockTenantLinkRepository linkRepository,
      StockProperties properties) {
    this.repository = repository;
    this.linkRepository = linkRepository;
    this.properties = properties;
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
   */
  @Transactional
  public Claim claimNext(long tenantId, Instant now) {
    Optional<StockOutboxEvent> head =
        repository.findFirstByTenantIdAndStatusInOrderByIdAsc(tenantId, OPEN_STATUSES);
    if (head.isEmpty()) {
      return new Claim(ClaimOutcome.EMPTY, null);
    }
    StockOutboxEvent event = repository.lockById(head.get().getId()).orElse(null);
    if (event == null) {
      return new Claim(ClaimOutcome.EMPTY, null);
    }
    switch (event.getStatus()) {
      case FAILED -> {
        return new Claim(ClaimOutcome.BLOCKED_BY_FAILED, null);
      }
      case PROCESSING -> {
        Instant started = event.getProcessingStartedAt();
        if (started != null && started.isAfter(now.minus(properties.getLeaseTtl()))) {
          return new Claim(ClaimOutcome.LEASE_HELD, null);
        }
      }
      case PENDING -> {
        if (event.getNextAttemptAt() != null && event.getNextAttemptAt().isAfter(now)) {
          return new Claim(ClaimOutcome.NOT_DUE, null);
        }
      }
      default -> {
        // DONE/DISCARDED changed under us between the read and the lock: look again next time.
        return new Claim(ClaimOutcome.EMPTY, null);
      }
    }
    event.setStatus(StockOutboxStatus.PROCESSING);
    event.setProcessingStartedAt(now);
    event.setAttemptCount(event.getAttemptCount() + 1);
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

  @Transactional
  public void markDone(long eventId, String responseJson, Instant now) {
    StockOutboxEvent event = repository.findById(eventId).orElseThrow();
    event.setStatus(StockOutboxStatus.DONE);
    event.setDoneAt(now);
    event.setProcessingStartedAt(null);
    event.setNextAttemptAt(null);
    event.setLastError(null);
    event.setResponseJson(responseJson);
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
    if (retryable && attempt <= delays.size()) {
      event.setStatus(StockOutboxStatus.PENDING);
      event.setNextAttemptAt(now.plus(delays.get(Math.max(0, attempt - 1))));
    } else {
      event.setStatus(StockOutboxStatus.FAILED);
      event.setNextAttemptAt(null);
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
            });
  }

  private static String truncate(String value) {
    if (value == null) {
      return null;
    }
    return value.length() <= MAX_ERROR_LENGTH ? value : value.substring(0, MAX_ERROR_LENGTH);
  }
}
