package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.enums.SifenSubmissionStatus;
import com.cursorpoc.backend.security.CorrelationIdFilter;
import java.time.LocalDateTime;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.slf4j.MDC;
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

  private SifenSubmissionQueueListener listener;

  @BeforeEach
  void setUp() {
    listener =
        new SifenSubmissionQueueListener(
            persistence, submissionService, new FemmeTimeProperties(), numberVoidingService);
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
}
