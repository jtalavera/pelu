package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.enums.SifenSubmissionStatus;
import com.cursorpoc.backend.repository.InvoiceRepository;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * RT-20 (Hardening_SIFEN.md): drives every backoff retry (Basic-tier Service Bus has no native
 * scheduled-message dependency here — see {@code SifenSubmissionQueueListener}'s backoff schedule,
 * which writes {@code sifen_next_attempt_at} instead of holding a message outstanding) and doubles
 * as the safety net for a message lost before ever reaching the queue (e.g. the backend crashing
 * between {@code InvoiceController#issue} persisting {@code QUEUED} and calling {@code
 * SifenSubmissionQueue#enqueue}) — both cases are just "an invoice whose next attempt is due,"
 * covered by one query ({@code InvoiceRepository#findDueForSifenRetry}).
 *
 * <p>Runs in every profile, including {@code e2e} — it's pure DB polling with no Service Bus
 * dependency, and {@code LocalAsyncSifenSubmissionQueue} losing its in-memory queue on a local
 * restart is exactly the gap this closes.
 */
@Component
public class SifenSubmissionReconciler {

  private static final Logger log = LoggerFactory.getLogger(SifenSubmissionReconciler.class);

  private static final List<SifenSubmissionStatus> RETRYABLE_STATUSES =
      List.of(SifenSubmissionStatus.QUEUED, SifenSubmissionStatus.PENDING_VERIFICATION);

  private final InvoiceRepository invoiceRepository;
  private final SifenSubmissionQueue queue;
  private final FemmeTimeProperties timeProperties;

  public SifenSubmissionReconciler(
      InvoiceRepository invoiceRepository,
      SifenSubmissionQueue queue,
      FemmeTimeProperties timeProperties) {
    this.invoiceRepository = invoiceRepository;
    this.queue = queue;
    this.timeProperties = timeProperties;
  }

  @Scheduled(fixedDelay = 60_000)
  public void reconcile() {
    LocalDateTime now = LocalDateTime.now(timeProperties.zoneId());
    LocalDateTime leaseExpiry = now.minus(SifenSubmissionQueueListener.LEASE_TTL);
    List<Invoice> due =
        invoiceRepository.findDueForSifenRetry(
            RETRYABLE_STATUSES, now, leaseExpiry, SifenSubmissionQueueListener.MAX_ATTEMPTS);
    for (Invoice invoice : due) {
      long tenantId = invoice.getTenant().getId();
      long invoiceId = invoice.getId();
      String correlationId = UUID.randomUUID().toString();
      log.info(
          "SIFEN submission reconciler re-enqueuing tenantId={} invoiceId={} attemptCount={}",
          tenantId,
          invoiceId,
          invoice.getSifenAttemptCount());
      queue.enqueue(
          tenantId, invoiceId, invoice.getSifenAttemptCount() + 1, Duration.ZERO, correlationId);
    }
  }
}
