package com.cursorpoc.backend.stock;

import com.cursorpoc.backend.domain.StockOutboxEvent;
import com.cursorpoc.backend.domain.StockTenantLink;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.StockOutboxStatus;
import com.cursorpoc.backend.repository.StockOutboxEventRepository;
import com.cursorpoc.backend.repository.StockTenantLinkRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.web.dto.PageResponse;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.server.ResponseStatusException;

/**
 * Stock integration (HU-62/HU-67): Platform Admin support tools — the outbox panel (list, retry,
 * discard), the failed-deliveries counter for the platform dashboard, and the per-tenant Stock
 * status + "sync catalog now" button.
 */
@Service
public class StockAdminService {

  /** {@code status=ALL}: no status filter at all. */
  public static final String STATUS_ALL = "ALL";

  private final StockOutboxEventRepository repository;
  private final StockTenantLinkRepository linkRepository;
  private final TenantRepository tenantRepository;
  private final StockOutboxService outbox;
  private final StockOutboxQueue queue;
  private final StockOutboxMessages messages;

  public StockAdminService(
      StockOutboxEventRepository repository,
      StockTenantLinkRepository linkRepository,
      TenantRepository tenantRepository,
      StockOutboxService outbox,
      StockOutboxQueue queue,
      StockOutboxMessages messages) {
    this.repository = repository;
    this.linkRepository = linkRepository;
    this.tenantRepository = tenantRepository;
    this.outbox = outbox;
    this.queue = queue;
    this.messages = messages;
  }

  public record OutboxEventRow(
      long id,
      long tenantId,
      String tenantName,
      String eventType,
      String status,
      int attemptCount,
      String lastError,
      Instant createdAt,
      Instant nextAttemptAt,
      Instant doneAt,
      String idempotencyKey,
      List<StockOutboxMessages.Entry> messages,
      Long blockedByEventId) {}

  public record OutboxSummary(long failed, long pending) {}

  public record TenantStockStatus(
      long tenantId,
      boolean stockEnabled,
      boolean linked,
      Instant provisionedAt,
      Instant catalogSyncedAt,
      long flagsVersion,
      String lastError,
      long failedEvents) {}

  /**
   * HU-67: without a status filter, lists what still needs attention (PENDING, PROCESSING, FAILED);
   * {@code ALL} lists every status (delivered and discarded too); any other value is exactly that
   * status.
   */
  @Transactional(readOnly = true)
  public PageResponse<OutboxEventRow> list(Long tenantId, String status, int page, int size) {
    PageRequest pageable = PageRequest.of(Math.max(0, page), Math.max(1, Math.min(size, 100)));
    Page<StockOutboxEvent> result;
    if (status == null || status.isBlank()) {
      result =
          repository.searchInStatuses(
              tenantId, StockOutboxPersistenceService.OPEN_STATUSES, pageable);
    } else if (STATUS_ALL.equalsIgnoreCase(status.trim())) {
      result = repository.search(tenantId, null, pageable);
    } else {
      StockOutboxStatus parsed;
      try {
        parsed = StockOutboxStatus.valueOf(status.trim().toUpperCase(Locale.ROOT));
      } catch (IllegalArgumentException e) {
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_STATUS");
      }
      result = repository.search(tenantId, parsed, pageable);
    }
    Map<Long, String> names = new HashMap<>();
    Map<Long, Optional<Long>> heads = new HashMap<>();
    List<OutboxEventRow> rows =
        result.getContent().stream()
            .map(
                e ->
                    toRow(
                        e,
                        names.computeIfAbsent(
                            e.getTenantId(),
                            id -> tenantRepository.findById(id).map(Tenant::getName).orElse("")),
                        heads))
            .toList();
    return new PageResponse<>(
        rows,
        result.getNumber(),
        result.getSize(),
        result.getTotalElements(),
        result.getTotalPages());
  }

  @Transactional(readOnly = true)
  public OutboxSummary summary() {
    return new OutboxSummary(
        repository.countByStatus(StockOutboxStatus.FAILED),
        repository.countByStatus(StockOutboxStatus.PENDING)
            + repository.countByStatus(StockOutboxStatus.PROCESSING));
  }

  /**
   * HU-67: "Reintentar" — a FAILED event goes back to PENDING (attempts restart); one that is
   * PENDING after a failed attempt (waiting out its backoff, possibly 24 h) is made due right now.
   * Either way the tenant is woken.
   */
  @Transactional
  public OutboxEventRow retry(long id) {
    StockOutboxEvent event = requireActionable(id);
    Instant now = Instant.now();
    if (event.getStatus() == StockOutboxStatus.FAILED) {
      event.setStatus(StockOutboxStatus.PENDING);
      event.setAttemptCount(0);
      messages.append(event, StockOutboxMessages.INFO, "RETRY_REQUESTED_AFTER_FAILURE", now);
    } else {
      messages.append(event, StockOutboxMessages.INFO, "RETRY_REQUESTED_NOW", now);
    }
    event.setNextAttemptAt(null);
    wakeAfterCommit(event.getTenantId());
    return toRow(event);
  }

  /** HU-67: an actionable event is given up on; the tenant's queue continues with the next one. */
  @Transactional
  public OutboxEventRow discard(long id) {
    StockOutboxEvent event = requireActionable(id);
    Instant now = Instant.now();
    event.setStatus(StockOutboxStatus.DISCARDED);
    event.setNextAttemptAt(null);
    event.setDoneAt(now);
    messages.append(event, StockOutboxMessages.WARN, "DISCARDED_MANUALLY", now);
    wakeAfterCommit(event.getTenantId());
    return toRow(event);
  }

  @Transactional(readOnly = true)
  public TenantStockStatus tenantStatus(long tenantId) {
    requireTenant(tenantId);
    StockTenantLink link = linkRepository.findById(tenantId).orElse(null);
    long failed =
        repository.findByTenantIdOrderByIdAsc(tenantId).stream()
            .filter(e -> e.getStatus() == StockOutboxStatus.FAILED)
            .count();
    return new TenantStockStatus(
        tenantId,
        outbox.stockEnabled(tenantId),
        link != null,
        link != null ? link.getProvisionedAt() : null,
        link != null ? link.getCatalogSyncedAt() : null,
        link != null ? link.getFlagsVersion() : 0L,
        link != null ? link.getLastError() : null,
        failed);
  }

  /** HU-62: "Sincronizar catálogo con Stock" — only for a tenant that has Stock. */
  @Transactional
  public TenantStockStatus requestCatalogSync(long tenantId) {
    requireTenant(tenantId);
    if (!outbox.stockEnabled(tenantId)) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "STOCK_MODULE_DISABLED");
    }
    outbox.enqueueCatalogFullSync(tenantId, true);
    return tenantStatus(tenantId);
  }

  /** FAILED, or PENDING after at least one failed attempt (waiting for its retry). */
  private StockOutboxEvent requireActionable(long id) {
    StockOutboxEvent event =
        repository
            .lockById(id)
            .orElseThrow(
                () ->
                    new ResponseStatusException(
                        HttpStatus.NOT_FOUND, "STOCK_OUTBOX_EVENT_NOT_FOUND"));
    boolean actionable =
        event.getStatus() == StockOutboxStatus.FAILED
            || (event.getStatus() == StockOutboxStatus.PENDING && event.getAttemptCount() > 0);
    if (!actionable) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "STOCK_OUTBOX_EVENT_NOT_ACTIONABLE");
    }
    return event;
  }

  private void requireTenant(long tenantId) {
    if (!tenantRepository.existsById(tenantId)) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "TENANT_NOT_FOUND");
    }
  }

  private OutboxEventRow toRow(StockOutboxEvent e) {
    return toRow(
        e,
        tenantRepository.findById(e.getTenantId()).map(Tenant::getName).orElse(""),
        new HashMap<>());
  }

  /**
   * {@code heads} caches each tenant's queue head: an open event that is not the head is waiting
   * behind it (the queue is strictly ordered), which the panel explains instead of leaving a
   * "Pending, 0 attempts" row unexplained.
   */
  private OutboxEventRow toRow(
      StockOutboxEvent e, String tenantName, Map<Long, Optional<Long>> heads) {
    Long blockedBy = null;
    if (StockOutboxPersistenceService.OPEN_STATUSES.contains(e.getStatus())) {
      Optional<Long> head =
          heads.computeIfAbsent(
              e.getTenantId(),
              t ->
                  repository
                      .findFirstByTenantIdAndStatusInOrderByIdAsc(
                          t, StockOutboxPersistenceService.OPEN_STATUSES)
                      .map(StockOutboxEvent::getId));
      if (head.isPresent() && head.get() != e.getId().longValue()) {
        blockedBy = head.get();
      }
    }
    return new OutboxEventRow(
        e.getId(),
        e.getTenantId(),
        tenantName,
        e.getEventType().name(),
        e.getStatus().name(),
        e.getAttemptCount(),
        e.getLastError(),
        e.getCreatedAt(),
        e.getNextAttemptAt(),
        e.getDoneAt(),
        e.getIdempotencyKey(),
        messages.read(e),
        blockedBy);
  }

  private void wakeAfterCommit(long tenantId) {
    if (!TransactionSynchronizationManager.isSynchronizationActive()) {
      queue.wake(tenantId, UUID.randomUUID().toString());
      return;
    }
    TransactionSynchronizationManager.registerSynchronization(
        new TransactionSynchronization() {
          @Override
          public void afterCommit() {
            queue.wake(tenantId, UUID.randomUUID().toString());
          }
        });
  }
}
