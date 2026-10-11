package com.cursorpoc.backend.stock;

import com.cursorpoc.backend.config.StockServiceBusConfiguration;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.stereotype.Service;

/**
 * Stock integration (HU-60): {@code e2e}/{@code test} stand-in for the {@code stock-integration}
 * Service Bus queue — genuinely asynchronous (one background thread), like {@code
 * LocalAsyncSifenSubmissionQueue}, so invoicing never waits on control-stock in e2e either.
 */
@Service
@ConditionalOnExpression(StockServiceBusConfiguration.DISABLED)
public class LocalAsyncStockOutboxQueue implements StockOutboxQueue, DisposableBean {

  private static final Logger log = LoggerFactory.getLogger(LocalAsyncStockOutboxQueue.class);

  private final StockOutboxProcessor processor;
  private final ExecutorService executor =
      Executors.newSingleThreadExecutor(
          r -> {
            Thread t = new Thread(r, "stock-local-outbox-queue");
            t.setDaemon(true);
            return t;
          });

  public LocalAsyncStockOutboxQueue(StockOutboxProcessor processor) {
    this.processor = processor;
  }

  @Override
  public void wake(long tenantId, String correlationId) {
    executor.execute(
        () -> {
          try {
            processor.processTenant(tenantId, correlationId);
          } catch (RuntimeException e) {
            log.error(
                "Local stock outbox task failed tenantId={} error={}", tenantId, e.toString());
          }
        });
  }

  @Override
  public void destroy() {
    executor.shutdownNow();
  }
}
