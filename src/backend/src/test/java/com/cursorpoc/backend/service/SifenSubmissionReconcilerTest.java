package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.SifenSubmissionStatus;
import com.cursorpoc.backend.repository.InvoiceRepository;
import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/** RT-20 (Hardening_SIFEN.md). */
@ExtendWith(MockitoExtension.class)
class SifenSubmissionReconcilerTest {

  @Mock private InvoiceRepository invoiceRepository;
  @Mock private SifenSubmissionQueue queue;

  private SifenSubmissionReconciler reconciler;

  @BeforeEach
  void setUp() {
    reconciler = new SifenSubmissionReconciler(invoiceRepository, queue, new FemmeTimeProperties());
  }

  private static Invoice invoiceOf(long id, long tenantId, int attemptCount) {
    Invoice invoice = new Invoice();
    invoice.setId(id);
    Tenant tenant = new Tenant();
    tenant.setId(tenantId);
    invoice.setTenant(tenant);
    invoice.setSifenAttemptCount(attemptCount);
    return invoice;
  }

  @Test
  void reconcile_enqueuesEveryDueInvoice() {
    when(invoiceRepository.findDueForSifenRetry(any(), any(), any(), anyInt()))
        .thenReturn(List.of(invoiceOf(10L, 1L, 1), invoiceOf(20L, 2L, 3)));

    reconciler.reconcile();

    verify(queue).enqueue(eq(1L), eq(10L), eq(2), eq(Duration.ZERO), any());
    verify(queue).enqueue(eq(2L), eq(20L), eq(4), eq(Duration.ZERO), any());
  }

  @Test
  void reconcile_queriesForBothQueuedAndPendingVerificationStatuses() {
    when(invoiceRepository.findDueForSifenRetry(any(), any(), any(), anyInt()))
        .thenReturn(List.of());

    reconciler.reconcile();

    ArgumentCaptor<List<SifenSubmissionStatus>> statusesCaptor =
        ArgumentCaptor.forClass(List.class);
    verify(invoiceRepository)
        .findDueForSifenRetry(statusesCaptor.capture(), any(), any(), anyInt());
    assertThat(statusesCaptor.getValue())
        .containsExactlyInAnyOrder(
            SifenSubmissionStatus.QUEUED, SifenSubmissionStatus.PENDING_VERIFICATION);
  }

  @Test
  void reconcile_usesTheListenersMaxAttempts_asTheCutoff() {
    when(invoiceRepository.findDueForSifenRetry(any(), any(), any(), anyInt()))
        .thenReturn(List.of());

    reconciler.reconcile();

    verify(invoiceRepository)
        .findDueForSifenRetry(any(), any(), any(), eq(SifenSubmissionQueueListener.MAX_ATTEMPTS));
  }

  @Test
  void reconcile_doesNothing_whenNothingIsDue() {
    when(invoiceRepository.findDueForSifenRetry(any(), any(), any(), anyInt()))
        .thenReturn(List.of());

    reconciler.reconcile();

    verify(queue, never()).enqueue(anyLong(), anyLong(), anyInt(), any(), any());
  }
}
