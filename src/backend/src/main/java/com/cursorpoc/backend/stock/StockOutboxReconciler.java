package com.cursorpoc.backend.stock;

import com.cursorpoc.backend.config.StockProperties;
import com.cursorpoc.backend.repository.StockOutboxEventRepository;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Stock integration (HU-60): the safety net, same role as {@code SifenSubmissionReconciler} — every
 * minute, re-wakes every tenant with an event that is due (a scheduled retry, or a wake-up lost
 * because the app died between the commit and the Service Bus send) or whose lease expired (the
 * worker died mid-call). Pure DB polling, runs in every profile.
 */
@Component
public class StockOutboxReconciler {

  private static final Logger log = LoggerFactory.getLogger(StockOutboxReconciler.class);

  private final StockOutboxEventRepository repository;
  private final StockOutboxQueue queue;
  private final StockProperties properties;

  public StockOutboxReconciler(
      StockOutboxEventRepository repository, StockOutboxQueue queue, StockProperties properties) {
    this.repository = repository;
    this.queue = queue;
    this.properties = properties;
  }

  @Scheduled(
      fixedDelayString = "${app.femme.stock.reconciler-interval:60000}",
      initialDelayString = "${app.femme.stock.reconciler-initial-delay:30000}")
  public void reconcile() {
    Instant now = Instant.now();
    List<Long> tenants =
        repository.findTenantIdsWithDueEvents(now, now.minus(properties.getLeaseTtl()));
    for (Long tenantId : tenants) {
      log.info("Stock outbox reconciler waking tenantId={}", tenantId);
      queue.wake(tenantId, UUID.randomUUID().toString());
    }
  }
}
