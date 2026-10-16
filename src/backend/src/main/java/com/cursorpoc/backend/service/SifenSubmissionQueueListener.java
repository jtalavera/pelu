package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.enums.SifenSubmissionStatus;
import com.cursorpoc.backend.security.CorrelationIdFilter;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/**
 * RT-20 (Hardening_SIFEN.md): the actual transmit-attempt handler, shared by both queue
 * implementations — {@code ServiceBusSifenSubmissionQueue}'s {@code ServiceBusProcessorClient}
 * calls {@link #processMessage} for a real message, {@link LocalAsyncSifenSubmissionQueue} calls it
 * directly from its background executor. Keeping the handler itself queue-agnostic means the
 * retry/dead-letter classification below is exercised identically in {@code e2e} and in Azure.
 *
 * <p>Terminal outcomes clear the retry schedule; a still-{@code PENDING_VERIFICATION} outcome
 * schedules the next backoff attempt via {@code sifen_next_attempt_at} (picked up later by {@code
 * SifenSubmissionReconciler}) rather than resending immediately — Basic-tier Service Bus has no
 * scheduled messages to lean on natively, and this also doubles as the safety net for messages lost
 * before ever reaching the queue.
 *
 * <p><b>Envío por lote</b> ({@code SIFEN_SYNC_SUBMISSION} off): an invoice pending in an accepted
 * lote is polled on its own, much faster schedule ({@link #BATCH_POLL_SCHEDULE}: 30 polls 1s apart,
 * then 15 polls 2s apart, then the usual minutes/hours) — SIFEN typically concludes a one-document
 * lote within seconds. Those polls are scheduled directly on the queue with a delay (Service Bus
 * scheduled messages / the local executor), since the reconciler only runs every 60s; {@code
 * sifen_next_attempt_at} is still set, with a margin, as the safety net if that scheduled message
 * is lost.
 */
@Service
public class SifenSubmissionQueueListener {

  private static final Logger log = LoggerFactory.getLogger(SifenSubmissionQueueListener.class);

  /** Longer than the ~30s SIFEN timeout, shorter than the shortest backoff below. */
  static final Duration LEASE_TTL = Duration.ofMinutes(5);

  /** Initial attempt + 5 backoff retries — matches the Service Bus queue's max_delivery_count. */
  static final int MAX_ATTEMPTS = 6;

  /** Delay before the next attempt, indexed by the just-finished attempt number (1-based) - 1. */
  private static final Duration[] BACKOFF = {
    Duration.ofMinutes(1),
    Duration.ofMinutes(5),
    Duration.ofMinutes(15),
    Duration.ofHours(1),
    Duration.ofHours(4)
  };

  /**
   * Envío por lote: wait before each consulta-lote poll, indexed by how many polls the lote already
   * had ({@code sifen_batch_poll_count}) and measured from the end of the previous one — 30 polls
   * every 1s, then 15 polls every 2s, then 1m, 5m, 15m, 1h and 4h. Count-based on purpose: each
   * SIFEN round trip itself takes seconds, so a time-based schedule would silently skip polls.
   */
  static final List<Duration> BATCH_POLL_SCHEDULE = buildBatchPollSchedule();

  private static List<Duration> buildBatchPollSchedule() {
    List<Duration> schedule = new ArrayList<>();
    schedule.addAll(Collections.nCopies(30, Duration.ofSeconds(1)));
    schedule.addAll(Collections.nCopies(15, Duration.ofSeconds(2)));
    schedule.addAll(
        List.of(
            Duration.ofMinutes(1),
            Duration.ofMinutes(5),
            Duration.ofMinutes(15),
            Duration.ofHours(1),
            Duration.ofHours(4)));
    return List.copyOf(schedule);
  }

  /**
   * Envío por lote: how many of the last {@link #BATCH_POLL_SCHEDULE} polls also ask {@code
   * SiConsDE} by CDC when the lote is still pending — SIFEN can leave a lote in {@code 0361} for
   * hours while the document itself is already approved.
   */
  static final int BATCH_CDC_CROSS_CHECK_POLLS = 10;

  /**
   * Whether the automatic poll that brought the lote's count to {@code pollsMade} also checks by
   * CDC: true for the last {@link #BATCH_CDC_CROSS_CHECK_POLLS} polls of the schedule (and any poll
   * past it).
   */
  static boolean crossChecksCdc(int pollsMade) {
    return pollsMade > BATCH_POLL_SCHEDULE.size() - BATCH_CDC_CROSS_CHECK_POLLS;
  }

  /**
   * Envío por lote: {@code sifen_next_attempt_at} lags the scheduled poll by this much, so the
   * reconciler only re-enqueues when the scheduled message was actually lost.
   */
  static final Duration BATCH_POLL_SAFETY_MARGIN = Duration.ofMinutes(2);

  /** Envío por lote: hard cap on attempts, independent of {@link #MAX_ATTEMPTS}. */
  static final int MAX_BATCH_ATTEMPTS = 1 + BATCH_POLL_SCHEDULE.size() + MAX_ATTEMPTS;

  private static final List<SifenSubmissionStatus> TERMINAL_STATUSES =
      List.of(
          SifenSubmissionStatus.APPROVED,
          SifenSubmissionStatus.APPROVED_WITH_OBSERVATION,
          SifenSubmissionStatus.REJECTED,
          SifenSubmissionStatus.CANCELLED);

  private final SifenInvoiceSubmissionPersistenceService persistence;
  private final SifenInvoiceSubmissionService submissionService;
  private final FemmeTimeProperties timeProperties;
  private final SifenNumberVoidingService numberVoidingService;
  private final SifenInvoiceNotificationService notificationService;

  /** Lazily resolved: {@link LocalAsyncSifenSubmissionQueue} itself depends on this listener. */
  private final ObjectProvider<SifenSubmissionQueue> queue;

  public SifenSubmissionQueueListener(
      SifenInvoiceSubmissionPersistenceService persistence,
      SifenInvoiceSubmissionService submissionService,
      FemmeTimeProperties timeProperties,
      SifenNumberVoidingService numberVoidingService,
      SifenInvoiceNotificationService notificationService,
      ObjectProvider<SifenSubmissionQueue> queue) {
    this.persistence = persistence;
    this.submissionService = submissionService;
    this.timeProperties = timeProperties;
    this.numberVoidingService = numberVoidingService;
    this.notificationService = notificationService;
    this.queue = queue;
  }

  /**
   * @return what happened, for callers (tests, the Service Bus processor) that need to know.
   */
  public Outcome processMessage(long tenantId, long invoiceId, int attempt, String correlationId) {
    MDC.put(CorrelationIdFilter.MDC_CORRELATION_ID, correlationId);
    MDC.put(CorrelationIdFilter.MDC_TENANT_ID, String.valueOf(tenantId));
    try {
      Optional<Integer> claimed = persistence.claimForSubmission(tenantId, invoiceId, LEASE_TTL);
      if (claimed.isEmpty()) {
        log.info(
            "SIFEN transmit skipped, lease held by another attempt tenantId={} invoiceId={}",
            tenantId,
            invoiceId);
        return Outcome.SKIPPED_LEASE_HELD;
      }

      try {
        SifenSubmissionResult result = submissionService.transmit(tenantId, invoiceId);
        return handleResult(tenantId, invoiceId, claimed.get(), result.status(), correlationId);
      } catch (ResponseStatusException e) {
        return handleException(tenantId, invoiceId, claimed.get(), e, correlationId);
      } catch (RuntimeException e) {
        log.error(
            "SIFEN transmit failed unexpectedly tenantId={} invoiceId={} error={}",
            tenantId,
            invoiceId,
            e.toString());
        persistence.releaseLease(tenantId, invoiceId);
        persistence.clearRetrySchedule(tenantId, invoiceId);
        return Outcome.DEAD_LETTERED;
      }
    } finally {
      MDC.remove(CorrelationIdFilter.MDC_CORRELATION_ID);
      MDC.remove(CorrelationIdFilter.MDC_TENANT_ID);
    }
  }

  private Outcome handleResult(
      long tenantId,
      long invoiceId,
      int attempt,
      SifenSubmissionStatus status,
      String correlationId) {
    if (TERMINAL_STATUSES.contains(status)) {
      persistence.clearRetrySchedule(tenantId, invoiceId);
      persistence.releaseLease(tenantId, invoiceId);
      if (status == SifenSubmissionStatus.REJECTED) {
        // RT-25: the rejected invoice's number will never be reused under this CDC — record it as
        // a pending inutilización for an admin to review and submit, per Manual Técnico V150.
        numberVoidingService.recordPendingForRejectedInvoice(tenantId, invoiceId);
      }
      if (status == SifenSubmissionStatus.APPROVED
          || status == SifenSubmissionStatus.APPROVED_WITH_OBSERVATION) {
        // Issue #173 item 2: SIFEN accepted the document — email its KuDE to the recipient. This
        // is a best-effort side effect; it never throws, so an email problem can't re-queue or
        // dead-letter an already-approved fiscal document.
        notificationService.emailKudeAfterApproval(tenantId, invoiceId);
      }
      log.info(
          "SIFEN transmit resolved tenantId={} invoiceId={} attempt={} status={}",
          tenantId,
          invoiceId,
          attempt,
          status);
      return Outcome.COMPLETED;
    }

    // Still PENDING_VERIFICATION (or, defensively, QUEUED if transmit somehow didn't advance it) —
    // SIFEN gave no answer yet; schedule another check rather than resending blindly.
    Optional<Integer> batchPollCount = persistence.findPendingBatchPollCount(tenantId, invoiceId);
    if (batchPollCount.isPresent()) {
      return scheduleBatchPollOrGiveUp(
          tenantId, invoiceId, attempt, batchPollCount.get(), correlationId);
    }
    return scheduleRetryOrGiveUp(tenantId, invoiceId, attempt, "still pending");
  }

  /**
   * Envío por lote: enqueues the next consulta-lote poll after the {@link #BATCH_POLL_SCHEDULE}
   * wait matching the polls already made. Once the whole schedule is used up (or {@link
   * #MAX_BATCH_ATTEMPTS} is hit) it stops polling; the invoice stays pending and the manual
   * "Verificar estado" button can still resolve it.
   */
  private Outcome scheduleBatchPollOrGiveUp(
      long tenantId, long invoiceId, int attempt, int pollsMade, String correlationId) {
    Optional<Duration> wait = nextBatchPollDelay(pollsMade);
    if (wait.isEmpty() || attempt >= MAX_BATCH_ATTEMPTS) {
      persistence.releaseLease(tenantId, invoiceId);
      persistence.clearRetrySchedule(tenantId, invoiceId);
      log.error(
          "SIFEN batch polling exhausted, invoice stays pending tenantId={} invoiceId={} "
              + "attempt={} pollsMade={}",
          tenantId,
          invoiceId,
          attempt,
          pollsMade);
      return Outcome.DEAD_LETTERED;
    }
    LocalDateTime nextPollAt = LocalDateTime.now(timeProperties.zoneId()).plus(wait.get());
    persistence.scheduleRetry(tenantId, invoiceId, nextPollAt.plus(BATCH_POLL_SAFETY_MARGIN));
    persistence.releaseLease(tenantId, invoiceId);
    queue.getObject().enqueue(tenantId, invoiceId, attempt + 1, wait.get(), correlationId);
    log.info(
        "SIFEN batch poll scheduled tenantId={} invoiceId={} attempt={} pollsMade={} delayMs={}",
        tenantId,
        invoiceId,
        attempt + 1,
        pollsMade,
        wait.get().toMillis());
    return Outcome.RETRY_SCHEDULED;
  }

  /** The wait before the next poll, given the polls already made — empty once exhausted. */
  static Optional<Duration> nextBatchPollDelay(int pollsMade) {
    return pollsMade >= 0 && pollsMade < BATCH_POLL_SCHEDULE.size()
        ? Optional.of(BATCH_POLL_SCHEDULE.get(pollsMade))
        : Optional.empty();
  }

  /**
   * {@code SIFEN_INVOICE_ALREADY_APPROVED} (409) and {@code SIFEN_SIGNATURE_EXPIRED} (412) are the
   * two guards {@code prepareForSubmission} can throw. RT-22 (Hardening_SIFEN.md): {@code
   * SIFEN_RATE_LIMIT_EXCEEDED} (429, {@link SifenRateLimiter}) is the third — unlike the other two,
   * it isn't a fact about this invoice at all, just this tenant's SIFEN traffic momentarily
   * exceeding its own budget, so it's retriable exactly like "still pending" rather than terminal.
   * {@code SIFEN_INVOICE_ALREADY_APPROVED} means another path already resolved it (nothing left to
   * do); {@code SIFEN_SIGNATURE_EXPIRED} means the 72h window elapsed (no point retrying; needs
   * manual attention, hence dead-lettered rather than silently dropped).
   */
  private Outcome handleException(
      long tenantId, long invoiceId, int attempt, ResponseStatusException e, String correlationId) {
    if (e.getStatusCode() == HttpStatus.CONFLICT) {
      persistence.releaseLease(tenantId, invoiceId);
      persistence.clearRetrySchedule(tenantId, invoiceId);
      log.info(
          "SIFEN transmit no-op, invoice already resolved tenantId={} invoiceId={} reason={}",
          tenantId,
          invoiceId,
          e.getReason());
      return Outcome.COMPLETED;
    }
    if (e.getStatusCode() == HttpStatus.TOO_MANY_REQUESTS) {
      log.warn(
          "SIFEN transmit rate-limited tenantId={} invoiceId={} attempt={}",
          tenantId,
          invoiceId,
          attempt);
      // A rate-limited consulta-lote wasn't counted as a poll, so it retries on the lote's own
      // fast cadence instead of falling back to the minute backoff.
      Optional<Integer> batchPollCount = persistence.findPendingBatchPollCount(tenantId, invoiceId);
      if (batchPollCount.isPresent()) {
        return scheduleBatchPollOrGiveUp(
            tenantId, invoiceId, attempt, batchPollCount.get(), correlationId);
      }
      return scheduleRetryOrGiveUp(tenantId, invoiceId, attempt, "rate limited");
    }
    persistence.releaseLease(tenantId, invoiceId);
    persistence.clearRetrySchedule(tenantId, invoiceId);
    log.error(
        "SIFEN transmit terminally failed tenantId={} invoiceId={} reason={}",
        tenantId,
        invoiceId,
        e.getReason());
    return Outcome.DEAD_LETTERED;
  }

  private Outcome scheduleRetryOrGiveUp(long tenantId, long invoiceId, int attempt, String reason) {
    if (attempt >= MAX_ATTEMPTS) {
      persistence.releaseLease(tenantId, invoiceId);
      log.error(
          "SIFEN transmit exhausted all attempts, giving up tenantId={} invoiceId={} attempt={} "
              + "reason={}",
          tenantId,
          invoiceId,
          attempt,
          reason);
      return Outcome.DEAD_LETTERED;
    }
    Duration backoff = BACKOFF[Math.min(attempt, BACKOFF.length) - 1];
    LocalDateTime nextAttemptAt = LocalDateTime.now(timeProperties.zoneId()).plus(backoff);
    persistence.scheduleRetry(tenantId, invoiceId, nextAttemptAt);
    persistence.releaseLease(tenantId, invoiceId);
    log.info(
        "SIFEN transmit scheduled retry tenantId={} invoiceId={} attempt={} reason={} "
            + "nextAttemptAt={}",
        tenantId,
        invoiceId,
        attempt,
        reason,
        nextAttemptAt);
    return Outcome.RETRY_SCHEDULED;
  }

  public enum Outcome {
    COMPLETED,
    RETRY_SCHEDULED,
    DEAD_LETTERED,
    SKIPPED_LEASE_HELD
  }
}
