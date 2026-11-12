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
 * <p>Envío por lote: an invoice pending in a lote is recovered up to {@code
 * SifenSubmissionQueueListener#MAX_BATCH_ATTEMPTS} instead of {@code MAX_ATTEMPTS} (see {@code
 * InvoiceRepository#findDueForSifenRetry}) — otherwise a scheduled consulta-lote poll lost after
 * the first few seconds of polling would never be re-enqueued.
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

  /**
   * After re-enqueuing an invoice, wait this long before re-enqueuing it again. Without it an
   * invoice whose message simply hadn't been consumed yet (QUEUED, {@code sifenNextAttemptAt} still
   * null) was re-enqueued on every 60s run — when the consumer was stuck (2026-11-12 prod incident)
   * that piled up hundreds of duplicate messages. The listener overwrites or clears the schedule as
   * soon as it actually processes the invoice, so this only spaces out the safety net.
   */
  static final Duration REENQUEUE_GRACE = Duration.ofMinutes(5);

  private final InvoiceRepository invoiceRepository;
  private final SifenSubmissionQueue queue;
  private final FemmeTimeProperties timeProperties;
  private final SifenInvoiceSubmissionPersistenceService persistence;

  public SifenSubmissionReconciler(
      InvoiceRepository invoiceRepository,
      SifenSubmissionQueue queue,
      FemmeTimeProperties timeProperties,
      SifenInvoiceSubmissionPersistenceService persistence) {
    this.invoiceRepository = invoiceRepository;
    this.queue = queue;
    this.timeProperties = timeProperties;
    this.persistence = persistence;
  }

  @Scheduled(fixedDelay = 60_000)
  public void reconcile() {
    LocalDateTime now = LocalDateTime.now(timeProperties.zoneId());
    LocalDateTime leaseExpiry = now.minus(SifenSubmissionQueueListener.LEASE_TTL);
    List<Invoice> due =
        invoiceRepository.findDueForSifenRetry(
            RETRYABLE_STATUSES,
            now,
            leaseExpiry,
            SifenSubmissionQueueListener.MAX_ATTEMPTS,
            SifenSubmissionStatus.PENDING_VERIFICATION,
            SifenSubmissionQueueListener.MAX_BATCH_ATTEMPTS);
    for (Invoice invoice : due) {
      long tenantId = invoice.getTenant().getId();
      long invoiceId = invoice.getId();
      String correlationId = UUID.randomUUID().toString();
      log.info(
          "SIFEN submission reconciler re-enqueuing tenantId={} invoiceId={} attemptCount={}",
          tenantId,
          invoiceId,
          invoice.getSifenAttemptCount());
      // Push the next safety-net run out first: the local async queue may process the message
      // (and set its own schedule) before enqueue() even returns.
      persistence.scheduleRetry(tenantId, invoiceId, now.plus(REENQUEUE_GRACE));
      queue.enqueue(
          tenantId, invoiceId, invoice.getSifenAttemptCount() + 1, Duration.ZERO, correlationId);
    }
  }
}
