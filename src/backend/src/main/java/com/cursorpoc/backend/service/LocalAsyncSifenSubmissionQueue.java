package com.cursorpoc.backend.service;

import java.time.Duration;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

/**
 * RT-08/RT-20 (Hardening_SIFEN.md): the {@code e2e} profile's stand-in for Azure Service Bus —
 * active only when {@code app.femme.servicebus.enabled=false} (see {@code
 * application-e2e.properties}/{@code application-test.properties}). Genuinely asynchronous (a
 * single background thread), not a synchronous fallback that calls {@link
 * SifenInvoiceSubmissionService#transmit} inline: a synchronous shortcut here would let Playwright
 * keep passing for the wrong reason and leave RT-20's central acceptance criterion — the issue
 * request never waits for SIFEN — with zero automated coverage anywhere in the suite.
 */
@Service
@ConditionalOnProperty(name = "app.femme.servicebus.enabled", havingValue = "false")
public class LocalAsyncSifenSubmissionQueue implements SifenSubmissionQueue {

  private static final Logger log = LoggerFactory.getLogger(LocalAsyncSifenSubmissionQueue.class);

  private final SifenSubmissionQueueListener listener;
  private final ScheduledExecutorService executor =
      Executors.newSingleThreadScheduledExecutor(
          r -> {
            Thread t = new Thread(r, "sifen-local-submission-queue");
            t.setDaemon(true);
            return t;
          });

  public LocalAsyncSifenSubmissionQueue(SifenSubmissionQueueListener listener) {
    this.listener = listener;
  }

  @Override
  public void enqueue(
      long tenantId, long invoiceId, int attempt, Duration delay, String correlationId) {
    executor.schedule(
        () -> {
          try {
            listener.processMessage(tenantId, invoiceId, attempt, correlationId);
          } catch (RuntimeException e) {
            log.error(
                "Local SIFEN submission queue task failed tenantId={} invoiceId={} error={}",
                tenantId,
                invoiceId,
                e.toString());
          }
        },
        Math.max(0, delay.toMillis()),
        TimeUnit.MILLISECONDS);
  }
}
