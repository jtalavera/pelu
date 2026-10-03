package com.cursorpoc.backend.stock;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.config.StockProperties;
import com.cursorpoc.backend.domain.FiscalStamp;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.InvoiceLine;
import com.cursorpoc.backend.domain.SalonService;
import com.cursorpoc.backend.domain.StockOutboxEvent;
import com.cursorpoc.backend.domain.enums.StockEventType;
import com.cursorpoc.backend.domain.enums.StockOutboxStatus;
import com.cursorpoc.backend.repository.StockOutboxEventRepository;
import com.cursorpoc.backend.service.FeatureFlagService;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import tools.jackson.databind.ObjectMapper;

/**
 * Stock integration (HU-60/HU-63/HU-64): writes outbox events <b>in the caller's transaction</b>
 * (the invoice, the void, the catalog edit…) so an event exists if and only if the change it
 * describes committed. Only for tenants whose {@code STOCK_MODULE} resolves ON. After the commit,
 * the tenant's worker is woken up through {@link StockOutboxQueue}; if that wake-up is lost, {@link
 * StockOutboxReconciler} finds the event within a minute.
 */
@Service
public class StockOutboxService {

  private static final Logger log = LoggerFactory.getLogger(StockOutboxService.class);

  public static final String STOCK_MODULE = "STOCK_MODULE";

  static final String DOC_TYPE_INVOICE = "INVOICE";

  private final StockOutboxEventRepository repository;
  private final FeatureFlagService featureFlagService;
  private final StockOutboxQueue queue;
  private final StockPayloads payloads;
  private final StockProperties properties;
  private final FemmeTimeProperties timeProperties;
  private final ObjectMapper objectMapper;

  public StockOutboxService(
      StockOutboxEventRepository repository,
      FeatureFlagService featureFlagService,
      StockOutboxQueue queue,
      StockPayloads payloads,
      StockProperties properties,
      FemmeTimeProperties timeProperties,
      ObjectMapper objectMapper) {
    this.repository = repository;
    this.featureFlagService = featureFlagService;
    this.queue = queue;
    this.payloads = payloads;
    this.properties = properties;
    this.timeProperties = timeProperties;
    this.objectMapper = objectMapper;
  }

  public boolean stockEnabled(long tenantId) {
    return featureFlagService.isEnabled(STOCK_MODULE, tenantId);
  }

  static String invoiceRef(long invoiceId) {
    return DOC_TYPE_INVOICE + ":" + invoiceId;
  }

  static String serviceRef(long serviceId) {
    return "SERVICE:" + serviceId;
  }

  // ── HU-63: sale ─────────────────────────────────────────────────────────────────────────────

  /**
   * Enqueues a {@code POST_SALE} document with one line per product line of the invoice. No-op when
   * the tenant has no Stock or the invoice has no product. {@code rev} distinguishes the sale of a
   * corrected invoice from the original (key {@code PELU:INVOICE:{id}:{rev}}).
   */
  @Transactional(propagation = Propagation.MANDATORY)
  public boolean enqueueSale(Invoice invoice) {
    long tenantId = invoice.getTenant().getId();
    if (!stockEnabled(tenantId)) {
      return false;
    }
    List<Map<String, Object>> lines = new ArrayList<>();
    int index = 0;
    for (InvoiceLine line : invoice.getLines()) {
      index++;
      SalonService service = line.getSalonService();
      if (service == null || !service.isProduct() || line.getQuantity() <= 0) {
        continue;
      }
      Map<String, Object> l = new LinkedHashMap<>();
      l.put("sourceLineId", line.getId() != null ? String.valueOf(line.getId()) : "L" + index);
      l.put("externalType", StockPayloads.EXTERNAL_TYPE);
      l.put("externalId", String.valueOf(service.getId()));
      l.put("quantity", line.getQuantity());
      lines.add(l);
    }
    if (lines.isEmpty()) {
      return false;
    }
    String ref = invoiceRef(invoice.getId());
    long rev =
        repository.countByTenantIdAndSourceRefAndEventType(tenantId, ref, StockEventType.SALE);
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("type", "ISSUE");
    body.put("reason", "SALE");
    body.put("timing", "POST_SALE");
    if (invoice.getIssuedAt() != null) {
      body.put("documentDate", invoice.getIssuedAt().atZone(timeProperties.zoneId()).toLocalDate());
    }
    body.put("source", source(invoice));
    body.put("lines", lines);
    enqueue(
        tenantId,
        StockEventType.SALE,
        ref,
        body,
        properties.getSourceSystem() + ":INVOICE:" + invoice.getId() + ":" + rev);
    return true;
  }

  // ── HU-64: reversal ─────────────────────────────────────────────────────────────────────────

  /**
   * Enqueues a {@code documents:reverse} for the invoice — only when a sale for it was enqueued
   * before (and not discarded). Each reversal gets its own key ({@code
   * PELU:INVOICE:{id}:REVERSE:{n}}) so a correction followed by a void reverses both sales.
   */
  @Transactional(propagation = Propagation.MANDATORY)
  public boolean enqueueReverse(Invoice invoice, String reason) {
    long tenantId = invoice.getTenant().getId();
    String ref = invoiceRef(invoice.getId());
    long sales =
        repository.countByTenantIdAndSourceRefAndEventTypeAndStatusNot(
            tenantId, ref, StockEventType.SALE, StockOutboxStatus.DISCARDED);
    if (sales == 0) {
      return false;
    }
    long reversals =
        repository.countByTenantIdAndSourceRefAndEventType(tenantId, ref, StockEventType.REVERSE);
    if (reversals >= sales) {
      // Every sale already has its reversal queued (e.g. SIFEN cancellation after a manual void).
      return false;
    }
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("source", source(invoice));
    if (reason != null && !reason.isBlank()) {
      body.put("reason", reason.length() > 500 ? reason.substring(0, 500) : reason);
    }
    enqueue(
        tenantId,
        StockEventType.REVERSE,
        ref,
        body,
        properties.getSourceSystem() + ":INVOICE:" + invoice.getId() + ":REVERSE:" + reversals);
    return true;
  }

  // ── HU-62: catalog ──────────────────────────────────────────────────────────────────────────

  /**
   * A product was created/edited/(de)activated, or an item stopped being a product ({@code
   * wasProduct}): Stock gets the new name/active state (an item that is no longer a product is sent
   * as inactive).
   */
  @Transactional(propagation = Propagation.MANDATORY)
  public boolean enqueueCatalogUpsert(SalonService service, boolean wasProduct) {
    long tenantId = service.getTenant().getId();
    if (!(service.isProduct() || wasProduct) || !stockEnabled(tenantId)) {
      return false;
    }
    enqueue(
        tenantId,
        StockEventType.CATALOG_UPSERT,
        serviceRef(service.getId()),
        payloads.bulkUpsert(List.of(payloads.catalogItem(service))),
        properties.getSourceSystem() + ":CATALOG:" + service.getId() + ":" + UUID.randomUUID());
    return true;
  }

  /** Full catalog sync (first activation, platform upload, manual button). */
  @Transactional
  public boolean enqueueCatalogFullSync(long tenantId, boolean force) {
    if (!force && !stockEnabled(tenantId)) {
      return false;
    }
    enqueue(
        tenantId,
        StockEventType.CATALOG_FULL_SYNC,
        null,
        Map.of(),
        properties.getSourceSystem() + ":CATALOG_FULL:" + tenantId + ":" + UUID.randomUUID());
    return true;
  }

  // ── HU-61: tenant + flags (called by StockFeatureFlagPublisher) ────────────────────────────

  @Transactional(propagation = Propagation.MANDATORY)
  public void enqueueTenantUpsert(long tenantId, Map<String, Object> body) {
    enqueue(
        tenantId,
        StockEventType.TENANT_UPSERT,
        null,
        body,
        properties.getSourceSystem() + ":TENANT:" + tenantId + ":" + UUID.randomUUID());
  }

  @Transactional(propagation = Propagation.MANDATORY)
  public void enqueueFlagsSync(long tenantId, long version, Map<String, Boolean> flags) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("source", properties.getSourceSystem());
    body.put("version", version);
    body.put("resolvedAt", Instant.now().toString());
    body.put("flags", flags);
    enqueue(
        tenantId,
        StockEventType.FEATURE_FLAGS_SYNC,
        null,
        body,
        properties.getSourceSystem() + ":FLAGS:" + tenantId + ":" + version);
  }

  // ── plumbing ────────────────────────────────────────────────────────────────────────────────

  private Map<String, Object> source(Invoice invoice) {
    Map<String, Object> source = new LinkedHashMap<>();
    source.put("system", properties.getSourceSystem());
    source.put("docType", DOC_TYPE_INVOICE);
    source.put("docId", String.valueOf(invoice.getId()));
    source.put("docNumber", documentNumber(invoice));
    return source;
  }

  /** e.g. {@code 001-001-0000123}, as printed on the comprobante. */
  static String documentNumber(Invoice invoice) {
    FiscalStamp stamp = invoice.getFiscalStamp();
    if (stamp == null) {
      return String.format("%07d", invoice.getInvoiceNumber());
    }
    return String.format(
        "%03d-%03d-%07d",
        stamp.getEstablishment(), stamp.getExpeditionPoint(), invoice.getInvoiceNumber());
  }

  private void enqueue(
      long tenantId,
      StockEventType type,
      String sourceRef,
      Map<String, Object> body,
      String idempotencyKey) {
    StockOutboxEvent event = new StockOutboxEvent();
    event.setTenantId(tenantId);
    event.setEventType(type);
    event.setSourceRef(sourceRef);
    event.setPayloadJson(objectMapper.writeValueAsString(body));
    event.setIdempotencyKey(idempotencyKey);
    event.setStatus(StockOutboxStatus.PENDING);
    event.setAttemptCount(0);
    event.setCreatedAt(Instant.now());
    repository.save(event);
    log.info(
        "Stock outbox event enqueued tenantId={} type={} key={}", tenantId, type, idempotencyKey);
    wakeAfterCommit(tenantId);
  }

  private static final String WAKE_RESOURCE = StockOutboxService.class.getName() + ".wake";

  /** Wakes each tenant at most once per transaction, and only once it has committed. */
  @SuppressWarnings("unchecked")
  private void wakeAfterCommit(long tenantId) {
    if (!TransactionSynchronizationManager.isSynchronizationActive()) {
      queue.wake(tenantId, UUID.randomUUID().toString());
      return;
    }
    Set<Long> tenants = (Set<Long>) TransactionSynchronizationManager.getResource(WAKE_RESOURCE);
    if (tenants == null) {
      Set<Long> pending = new LinkedHashSet<>();
      TransactionSynchronizationManager.bindResource(WAKE_RESOURCE, pending);
      TransactionSynchronizationManager.registerSynchronization(
          new TransactionSynchronization() {
            @Override
            public void afterCommit() {
              for (Long t : pending) {
                queue.wake(t, UUID.randomUUID().toString());
              }
            }

            @Override
            public void afterCompletion(int status) {
              TransactionSynchronizationManager.unbindResourceIfPossible(WAKE_RESOURCE);
            }
          });
      tenants = pending;
    }
    tenants.add(tenantId);
  }
}
