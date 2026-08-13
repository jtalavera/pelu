package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.enums.SifenSubmissionStatus;
import com.cursorpoc.backend.security.CorrelationIdFilter;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
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

  public SifenSubmissionQueueListener(
      SifenInvoiceSubmissionPersistenceService persistence,
      SifenInvoiceSubmissionService submissionService,
      FemmeTimeProperties timeProperties,
      SifenNumberVoidingService numberVoidingService) {
    this.persistence = persistence;
    this.submissionService = submissionService;
    this.timeProperties = timeProperties;
    this.numberVoidingService = numberVoidingService;
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
        return handleResult(tenantId, invoiceId, claimed.get(), result.status());
      } catch (ResponseStatusException e) {
        return handleException(tenantId, invoiceId, claimed.get(), e);
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
      long tenantId, long invoiceId, int attempt, SifenSubmissionStatus status) {
    if (TERMINAL_STATUSES.contains(status)) {
      persistence.clearRetrySchedule(tenantId, invoiceId);
      persistence.releaseLease(tenantId, invoiceId);
      if (status == SifenSubmissionStatus.REJECTED) {
        // RT-25: the rejected invoice's number will never be reused under this CDC — record it as
        // a pending inutilización for an admin to review and submit, per Manual Técnico V150.
        numberVoidingService.recordPendingForRejectedInvoice(tenantId, invoiceId);
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
    return scheduleRetryOrGiveUp(tenantId, invoiceId, attempt, "still pending");
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
      long tenantId, long invoiceId, int attempt, ResponseStatusException e) {
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
