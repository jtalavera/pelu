package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.enums.SifenSubmissionStatus;
import com.cursorpoc.backend.security.CorrelationIdFilter;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.slf4j.MDC;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** RT-20 (Hardening_SIFEN.md). */
@ExtendWith(MockitoExtension.class)
class SifenSubmissionQueueListenerTest {

  private static final long TENANT_ID = 1L;
  private static final long INVOICE_ID = 100L;
  private static final String CORRELATION_ID = "corr-1";

  @Mock private SifenInvoiceSubmissionPersistenceService persistence;
  @Mock private SifenInvoiceSubmissionService submissionService;
  @Mock private SifenNumberVoidingService numberVoidingService;
  @Mock private SifenInvoiceNotificationService notificationService;
  @Mock private ObjectProvider<SifenSubmissionQueue> queueProvider;
  @Mock private SifenSubmissionQueue queue;

  private SifenSubmissionQueueListener listener;

  @BeforeEach
  void setUp() {
    listener =
        new SifenSubmissionQueueListener(
            persistence,
            submissionService,
            new FemmeTimeProperties(),
            numberVoidingService,
            notificationService,
            queueProvider);
    lenient().when(queueProvider.getObject()).thenReturn(queue);
  }

  @Test
  void processMessage_skipsTransmit_whenLeaseIsAlreadyHeld() {
    when(persistence.claimForSubmission(eq(TENANT_ID), eq(INVOICE_ID), any()))
        .thenReturn(Optional.empty());

    var outcome = listener.processMessage(TENANT_ID, INVOICE_ID, 1, CORRELATION_ID);

    assertThat(outcome).isEqualTo(SifenSubmissionQueueListener.Outcome.SKIPPED_LEASE_HELD);
    verify(submissionService, never()).transmit(anyLong(), anyLong());
  }

  @Test
  void processMessage_completes_whenTransmitResolvesApproved() {
    when(persistence.claimForSubmission(eq(TENANT_ID), eq(INVOICE_ID), any()))
        .thenReturn(Optional.of(1));
    when(submissionService.transmit(TENANT_ID, INVOICE_ID))
        .thenReturn(
            new SifenSubmissionResult(
                SifenSubmissionStatus.APPROVED, "123", "0260", "Autorizado", LocalDateTime.now()));

    var outcome = listener.processMessage(TENANT_ID, INVOICE_ID, 1, CORRELATION_ID);

    assertThat(outcome).isEqualTo(SifenSubmissionQueueListener.Outcome.COMPLETED);
    verify(persistence).clearRetrySchedule(TENANT_ID, INVOICE_ID);
    verify(persistence).releaseLease(TENANT_ID, INVOICE_ID);
    verify(numberVoidingService, never()).recordPendingForRejectedInvoice(anyLong(), anyLong());
    // Issue #173 item 2: SIFEN approved → the KuDE is auto-emailed.
    verify(notificationService).emailKudeAfterApproval(TENANT_ID, INVOICE_ID);
  }

  /** Issue #173 item 2: a non-approved terminal result never triggers the KuDE auto-email. */
  @Test
  void processMessage_rejected_doesNotEmailKude() {
    when(persistence.claimForSubmission(eq(TENANT_ID), eq(INVOICE_ID), any()))
        .thenReturn(Optional.of(1));
    when(submissionService.transmit(TENANT_ID, INVOICE_ID))
        .thenReturn(
            new SifenSubmissionResult(
                SifenSubmissionStatus.REJECTED, "123", "1001", "Rechazado", LocalDateTime.now()));

    listener.processMessage(TENANT_ID, INVOICE_ID, 1, CORRELATION_ID);

    verify(notificationService, never()).emailKudeAfterApproval(anyLong(), anyLong());
  }

  /** RT-25 (Hardening_SIFEN.md): a rejected transmit records a pending inutilización. */
  @Test
  void processMessage_recordsPendingNumberVoiding_whenTransmitResolvesRejected() {
    when(persistence.claimForSubmission(eq(TENANT_ID), eq(INVOICE_ID), any()))
        .thenReturn(Optional.of(1));
    when(submissionService.transmit(TENANT_ID, INVOICE_ID))
        .thenReturn(
            new SifenSubmissionResult(
                SifenSubmissionStatus.REJECTED, "123", "0261", "Rechazado", LocalDateTime.now()));

    var outcome = listener.processMessage(TENANT_ID, INVOICE_ID, 1, CORRELATION_ID);

    assertThat(outcome).isEqualTo(SifenSubmissionQueueListener.Outcome.COMPLETED);
    verify(numberVoidingService).recordPendingForRejectedInvoice(TENANT_ID, INVOICE_ID);
  }

  @Test
  void processMessage_schedulesRetry_whenStillPendingVerificationAndAttemptsRemain() {
    when(persistence.claimForSubmission(eq(TENANT_ID), eq(INVOICE_ID), any()))
        .thenReturn(Optional.of(2));
    when(submissionService.transmit(TENANT_ID, INVOICE_ID))
        .thenReturn(
            new SifenSubmissionResult(
                SifenSubmissionStatus.PENDING_VERIFICATION, null, null, null, null));

    var outcome = listener.processMessage(TENANT_ID, INVOICE_ID, 2, CORRELATION_ID);

    assertThat(outcome).isEqualTo(SifenSubmissionQueueListener.Outcome.RETRY_SCHEDULED);
    verify(persistence).scheduleRetry(eq(TENANT_ID), eq(INVOICE_ID), any());
    verify(persistence).releaseLease(TENANT_ID, INVOICE_ID);
  }

  @Test
  void processMessage_deadLetters_whenAttemptsExhaustedAndStillPending() {
    when(persistence.claimForSubmission(eq(TENANT_ID), eq(INVOICE_ID), any()))
        .thenReturn(Optional.of(SifenSubmissionQueueListener.MAX_ATTEMPTS));
    when(submissionService.transmit(TENANT_ID, INVOICE_ID))
        .thenReturn(
            new SifenSubmissionResult(
                SifenSubmissionStatus.PENDING_VERIFICATION, null, null, null, null));

    var outcome = listener.processMessage(TENANT_ID, INVOICE_ID, 6, CORRELATION_ID);

    assertThat(outcome).isEqualTo(SifenSubmissionQueueListener.Outcome.DEAD_LETTERED);
    verify(persistence, never()).scheduleRetry(anyLong(), anyLong(), any());
    verify(persistence).releaseLease(TENANT_ID, INVOICE_ID);
  }

  @Test
  void processMessage_completesWithoutRetry_whenAlreadyApprovedOutOfBand() {
    when(persistence.claimForSubmission(eq(TENANT_ID), eq(INVOICE_ID), any()))
        .thenReturn(Optional.of(1));
    when(submissionService.transmit(TENANT_ID, INVOICE_ID))
        .thenThrow(
            new ResponseStatusException(HttpStatus.CONFLICT, "SIFEN_INVOICE_ALREADY_APPROVED"));

    var outcome = listener.processMessage(TENANT_ID, INVOICE_ID, 1, CORRELATION_ID);

    assertThat(outcome).isEqualTo(SifenSubmissionQueueListener.Outcome.COMPLETED);
    verify(persistence).releaseLease(TENANT_ID, INVOICE_ID);
    verify(persistence).clearRetrySchedule(TENANT_ID, INVOICE_ID);
  }

  /**
   * RT-22 (Hardening_SIFEN.md): a 429 from {@code SifenRateLimiter} is a fact about this tenant's
   * traffic, not this invoice — it must be retried, not dead-lettered, unlike the other two {@link
   * ResponseStatusException}s this listener classifies.
   */
  @Test
  void processMessage_schedulesRetry_whenRateLimited() {
    when(persistence.claimForSubmission(eq(TENANT_ID), eq(INVOICE_ID), any()))
        .thenReturn(Optional.of(1));
    when(submissionService.transmit(TENANT_ID, INVOICE_ID))
        .thenThrow(
            new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "SIFEN_RATE_LIMIT_EXCEEDED"));

    var outcome = listener.processMessage(TENANT_ID, INVOICE_ID, 1, CORRELATION_ID);

    assertThat(outcome).isEqualTo(SifenSubmissionQueueListener.Outcome.RETRY_SCHEDULED);
    verify(persistence).scheduleRetry(eq(TENANT_ID), eq(INVOICE_ID), any());
    verify(persistence).releaseLease(TENANT_ID, INVOICE_ID);
    verify(persistence, never()).clearRetrySchedule(TENANT_ID, INVOICE_ID);
  }

  @Test
  void processMessage_deadLetters_whenRateLimitedAndAttemptsExhausted() {
    when(persistence.claimForSubmission(eq(TENANT_ID), eq(INVOICE_ID), any()))
        .thenReturn(Optional.of(SifenSubmissionQueueListener.MAX_ATTEMPTS));
    when(submissionService.transmit(TENANT_ID, INVOICE_ID))
        .thenThrow(
            new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "SIFEN_RATE_LIMIT_EXCEEDED"));

    var outcome = listener.processMessage(TENANT_ID, INVOICE_ID, 6, CORRELATION_ID);

    assertThat(outcome).isEqualTo(SifenSubmissionQueueListener.Outcome.DEAD_LETTERED);
  }

  @Test
  void processMessage_deadLetters_whenSignatureWindowExpired() {
    when(persistence.claimForSubmission(eq(TENANT_ID), eq(INVOICE_ID), any()))
        .thenReturn(Optional.of(3));
    when(submissionService.transmit(TENANT_ID, INVOICE_ID))
        .thenThrow(
            new ResponseStatusException(HttpStatus.PRECONDITION_FAILED, "SIFEN_SIGNATURE_EXPIRED"));

    var outcome = listener.processMessage(TENANT_ID, INVOICE_ID, 3, CORRELATION_ID);

    assertThat(outcome).isEqualTo(SifenSubmissionQueueListener.Outcome.DEAD_LETTERED);
    verify(persistence).releaseLease(TENANT_ID, INVOICE_ID);
  }

  @Test
  void processMessage_deadLetters_onAnyUnexpectedException() {
    when(persistence.claimForSubmission(eq(TENANT_ID), eq(INVOICE_ID), any()))
        .thenReturn(Optional.of(1));
    when(submissionService.transmit(TENANT_ID, INVOICE_ID))
        .thenThrow(new IllegalStateException("boom"));

    var outcome = listener.processMessage(TENANT_ID, INVOICE_ID, 1, CORRELATION_ID);

    assertThat(outcome).isEqualTo(SifenSubmissionQueueListener.Outcome.DEAD_LETTERED);
    verify(persistence).releaseLease(TENANT_ID, INVOICE_ID);
  }

  /** RT-21: MDC must carry both keys while transmit() runs, and neither must leak afterward. */
  @Test
  void processMessage_setsAndClearsMdc() {
    when(persistence.claimForSubmission(eq(TENANT_ID), eq(INVOICE_ID), any()))
        .thenAnswer(
            inv -> {
              assertThat(MDC.get(CorrelationIdFilter.MDC_CORRELATION_ID)).isEqualTo(CORRELATION_ID);
              assertThat(MDC.get(CorrelationIdFilter.MDC_TENANT_ID)).isEqualTo("1");
              return Optional.of(1);
            });
    when(submissionService.transmit(TENANT_ID, INVOICE_ID))
        .thenReturn(
            new SifenSubmissionResult(
                SifenSubmissionStatus.APPROVED, null, null, null, LocalDateTime.now()));

    listener.processMessage(TENANT_ID, INVOICE_ID, 1, CORRELATION_ID);

    assertThat(MDC.get(CorrelationIdFilter.MDC_CORRELATION_ID)).isNull();
    assertThat(MDC.get(CorrelationIdFilter.MDC_TENANT_ID)).isNull();
  }

  // --- Envío por lote: 30 polls every 1s, 15 every 2s, then 1m/5m/15m/1h/4h ---

  @Test
  void batchPollSchedule_is30At1s_then15At2s_thenTheMinuteAndHourBackoff() {
    var schedule = SifenSubmissionQueueListener.BATCH_POLL_SCHEDULE;
    assertThat(schedule).hasSize(50);
    assertThat(schedule.subList(0, 30)).containsOnly(Duration.ofSeconds(1));
    assertThat(schedule.subList(30, 45)).containsOnly(Duration.ofSeconds(2));
    assertThat(schedule.subList(45, 50))
        .containsExactly(
            Duration.ofMinutes(1),
            Duration.ofMinutes(5),
            Duration.ofMinutes(15),
            Duration.ofHours(1),
            Duration.ofHours(4));

    assertThat(SifenSubmissionQueueListener.nextBatchPollDelay(0)).contains(Duration.ofSeconds(1));
    assertThat(SifenSubmissionQueueListener.nextBatchPollDelay(29)).contains(Duration.ofSeconds(1));
    assertThat(SifenSubmissionQueueListener.nextBatchPollDelay(30)).contains(Duration.ofSeconds(2));
    assertThat(SifenSubmissionQueueListener.nextBatchPollDelay(44)).contains(Duration.ofSeconds(2));
    assertThat(SifenSubmissionQueueListener.nextBatchPollDelay(45)).contains(Duration.ofMinutes(1));
    assertThat(SifenSubmissionQueueListener.nextBatchPollDelay(49)).contains(Duration.ofHours(4));
    assertThat(SifenSubmissionQueueListener.nextBatchPollDelay(50)).isEmpty();
  }

  /** The last 10 of the 50 scheduled polls (counts 41..50) also ask SIFEN by CDC. */
  @Test
  void crossChecksCdc_onlyForTheLastTenPollsOfTheSchedule() {
    assertThat(SifenSubmissionQueueListener.crossChecksCdc(1)).isFalse();
    assertThat(SifenSubmissionQueueListener.crossChecksCdc(40)).isFalse();
    assertThat(SifenSubmissionQueueListener.crossChecksCdc(41)).isTrue();
    assertThat(SifenSubmissionQueueListener.crossChecksCdc(50)).isTrue();
    assertThat(SifenSubmissionQueueListener.crossChecksCdc(52)).isTrue();
  }

  @Test
  void processMessage_schedulesFirstConsultaLote1sAfterTheLoteWasAccepted() {
    stillPendingOnAttempt(1);
    when(persistence.findPendingBatchPollCount(TENANT_ID, INVOICE_ID)).thenReturn(Optional.of(0));

    var outcome = listener.processMessage(TENANT_ID, INVOICE_ID, 1, CORRELATION_ID);

    assertThat(outcome).isEqualTo(SifenSubmissionQueueListener.Outcome.RETRY_SCHEDULED);
    verify(queue).enqueue(TENANT_ID, INVOICE_ID, 2, Duration.ofSeconds(1), CORRELATION_ID);
    // The reconciler's safety net trails the scheduled poll by the margin, never races it.
    ArgumentCaptor<LocalDateTime> safetyNet = ArgumentCaptor.forClass(LocalDateTime.class);
    verify(persistence).scheduleRetry(eq(TENANT_ID), eq(INVOICE_ID), safetyNet.capture());
    assertThat(safetyNet.getValue())
        .isAfter(
            LocalDateTime.now(new FemmeTimeProperties().zoneId())
                .plus(SifenSubmissionQueueListener.BATCH_POLL_SAFETY_MARGIN));
    verify(persistence).releaseLease(TENANT_ID, INVOICE_ID);
  }

  @Test
  void processMessage_waits2s_afterThe30thPoll() {
    stillPendingOnAttempt(31);
    when(persistence.findPendingBatchPollCount(TENANT_ID, INVOICE_ID)).thenReturn(Optional.of(30));

    listener.processMessage(TENANT_ID, INVOICE_ID, 31, CORRELATION_ID);

    verify(queue).enqueue(TENANT_ID, INVOICE_ID, 32, Duration.ofSeconds(2), CORRELATION_ID);
  }

  @Test
  void processMessage_fallsToTheMinuteBackoff_afterThe45thPoll() {
    stillPendingOnAttempt(46);
    when(persistence.findPendingBatchPollCount(TENANT_ID, INVOICE_ID)).thenReturn(Optional.of(45));

    listener.processMessage(TENANT_ID, INVOICE_ID, 46, CORRELATION_ID);

    verify(queue).enqueue(TENANT_ID, INVOICE_ID, 47, Duration.ofMinutes(1), CORRELATION_ID);
  }

  @Test
  void processMessage_stopsPollingTheLote_onceTheWholeScheduleIsUsedUp() {
    stillPendingOnAttempt(51);
    when(persistence.findPendingBatchPollCount(TENANT_ID, INVOICE_ID)).thenReturn(Optional.of(50));

    var outcome = listener.processMessage(TENANT_ID, INVOICE_ID, 51, CORRELATION_ID);

    assertThat(outcome).isEqualTo(SifenSubmissionQueueListener.Outcome.DEAD_LETTERED);
    verify(queue, never())
        .enqueue(anyLong(), anyLong(), org.mockito.ArgumentMatchers.anyInt(), any(), any());
    verify(persistence).clearRetrySchedule(TENANT_ID, INVOICE_ID);
    verify(persistence).releaseLease(TENANT_ID, INVOICE_ID);
  }

  @Test
  void processMessage_retriesARateLimitedConsultaLote_onTheLoteCadence() {
    when(persistence.claimForSubmission(eq(TENANT_ID), eq(INVOICE_ID), any()))
        .thenReturn(Optional.of(5));
    when(submissionService.transmit(TENANT_ID, INVOICE_ID))
        .thenThrow(
            new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "SIFEN_RATE_LIMIT_EXCEEDED"));
    when(persistence.findPendingBatchPollCount(TENANT_ID, INVOICE_ID)).thenReturn(Optional.of(4));

    var outcome = listener.processMessage(TENANT_ID, INVOICE_ID, 5, CORRELATION_ID);

    assertThat(outcome).isEqualTo(SifenSubmissionQueueListener.Outcome.RETRY_SCHEDULED);
    verify(queue).enqueue(TENANT_ID, INVOICE_ID, 6, Duration.ofSeconds(1), CORRELATION_ID);
  }

  @Test
  void processMessage_keepsTheMinuteBackoff_forAPendingInvoiceNotInALote() {
    stillPendingOnAttempt(1);

    var outcome = listener.processMessage(TENANT_ID, INVOICE_ID, 1, CORRELATION_ID);

    assertThat(outcome).isEqualTo(SifenSubmissionQueueListener.Outcome.RETRY_SCHEDULED);
    verify(queue, never())
        .enqueue(anyLong(), anyLong(), org.mockito.ArgumentMatchers.anyInt(), any(), any());
    verify(persistence).scheduleRetry(eq(TENANT_ID), eq(INVOICE_ID), any());
  }

  private void stillPendingOnAttempt(int attempt) {
    when(persistence.claimForSubmission(eq(TENANT_ID), eq(INVOICE_ID), any()))
        .thenReturn(Optional.of(attempt));
    when(submissionService.transmit(TENANT_ID, INVOICE_ID))
        .thenReturn(
            new SifenSubmissionResult(
                SifenSubmissionStatus.PENDING_VERIFICATION, null, null, null, null));
  }
}
