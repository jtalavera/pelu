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

  private final StockOutboxEventRepository repository;
  private final StockTenantLinkRepository linkRepository;
  private final TenantRepository tenantRepository;
  private final StockOutboxService outbox;
  private final StockOutboxQueue queue;

  public StockAdminService(
      StockOutboxEventRepository repository,
      StockTenantLinkRepository linkRepository,
      TenantRepository tenantRepository,
      StockOutboxService outbox,
      StockOutboxQueue queue) {
    this.repository = repository;
    this.linkRepository = linkRepository;
    this.tenantRepository = tenantRepository;
    this.outbox = outbox;
    this.queue = queue;
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
      String idempotencyKey) {}

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
   * with one, exactly that status.
   */
  @Transactional(readOnly = true)
  public PageResponse<OutboxEventRow> list(Long tenantId, String status, int page, int size) {
    PageRequest pageable = PageRequest.of(Math.max(0, page), Math.max(1, Math.min(size, 100)));
    Page<StockOutboxEvent> result;
    if (status == null || status.isBlank()) {
      result =
          repository.searchInStatuses(
              tenantId, StockOutboxPersistenceService.OPEN_STATUSES, pageable);
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
    List<OutboxEventRow> rows =
        result.getContent().stream()
            .map(
                e ->
                    new OutboxEventRow(
                        e.getId(),
                        e.getTenantId(),
                        names.computeIfAbsent(
                            e.getTenantId(),
                            id -> tenantRepository.findById(id).map(Tenant::getName).orElse("")),
                        e.getEventType().name(),
                        e.getStatus().name(),
                        e.getAttemptCount(),
                        e.getLastError(),
                        e.getCreatedAt(),
                        e.getNextAttemptAt(),
                        e.getDoneAt(),
                        e.getIdempotencyKey()))
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

  /** HU-67: a FAILED event goes back to PENDING (attempts restart) and the tenant is woken. */
  @Transactional
  public OutboxEventRow retry(long id) {
    StockOutboxEvent event = requireFailed(id);
    event.setStatus(StockOutboxStatus.PENDING);
    event.setNextAttemptAt(null);
    event.setAttemptCount(0);
    wakeAfterCommit(event.getTenantId());
    return toRow(event);
  }

  /** HU-67: a FAILED event is given up on; the tenant's queue continues with the next one. */
  @Transactional
  public OutboxEventRow discard(long id) {
    StockOutboxEvent event = requireFailed(id);
    event.setStatus(StockOutboxStatus.DISCARDED);
    event.setNextAttemptAt(null);
    event.setDoneAt(Instant.now());
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

  private StockOutboxEvent requireFailed(long id) {
    StockOutboxEvent event =
        repository
            .lockById(id)
            .orElseThrow(
                () ->
                    new ResponseStatusException(
                        HttpStatus.NOT_FOUND, "STOCK_OUTBOX_EVENT_NOT_FOUND"));
    if (event.getStatus() != StockOutboxStatus.FAILED) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "STOCK_OUTBOX_EVENT_NOT_FAILED");
    }
    return event;
  }

  private void requireTenant(long tenantId) {
    if (!tenantRepository.existsById(tenantId)) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "TENANT_NOT_FOUND");
    }
  }

  private OutboxEventRow toRow(StockOutboxEvent e) {
    return new OutboxEventRow(
        e.getId(),
        e.getTenantId(),
        tenantRepository.findById(e.getTenantId()).map(Tenant::getName).orElse(""),
        e.getEventType().name(),
        e.getStatus().name(),
        e.getAttemptCount(),
        e.getLastError(),
        e.getCreatedAt(),
        e.getNextAttemptAt(),
        e.getDoneAt(),
        e.getIdempotencyKey());
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
