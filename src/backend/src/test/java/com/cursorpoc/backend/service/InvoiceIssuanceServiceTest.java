package com.cursorpoc.backend.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.web.dto.InvoiceCorrectionRequest;
import com.cursorpoc.backend.web.dto.InvoiceCreateRequest;
import com.cursorpoc.backend.web.dto.InvoiceResponse;
import java.time.Duration;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.server.ResponseStatusException;

class InvoiceIssuanceServiceTest {

  private static final long TENANT_ID = 7L;
  private static final long INVOICE_ID = 42L;

  private InvoiceService invoiceService;
  private SifenInvoiceSubmissionService submissionService;
  private SifenSubmissionQueue queue;
  private InvoiceIssuanceService service;
  private InvoiceCreateRequest request;
  private InvoiceResponse issued;
  private InvoiceResponse finalResponse;

  @BeforeEach
  void setUp() {
    invoiceService = mock(InvoiceService.class);
    submissionService = mock(SifenInvoiceSubmissionService.class);
    queue = mock(SifenSubmissionQueue.class);
    service = new InvoiceIssuanceService(invoiceService, submissionService, queue);
    request = mock(InvoiceCreateRequest.class);
    issued = mock(InvoiceResponse.class);
    finalResponse = mock(InvoiceResponse.class);
    when(issued.id()).thenReturn(INVOICE_ID);
    when(invoiceService.issueInvoice(TENANT_ID, request)).thenReturn(issued);
    when(invoiceService.getInvoice(TENANT_ID, INVOICE_ID)).thenReturn(finalResponse);
    TransactionSynchronizationManager.initSynchronization();
  }

  @AfterEach
  void tearDown() {
    TransactionSynchronizationManager.clearSynchronization();
  }

  @Test
  void issueWithSifen_propagatesSigningFailureAndNeverEnqueues() {
    ResponseStatusException failure =
        new ResponseStatusException(HttpStatus.PRECONDITION_FAILED, "SIFEN_ISSUER_ADDRESS_MISSING");
    doThrow(failure).when(submissionService).prepareAndSign(TENANT_ID, INVOICE_ID);

    ResponseStatusException thrown =
        assertThrows(
            ResponseStatusException.class, () -> service.issueWithSifen(TENANT_ID, request));

    assertEquals("SIFEN_ISSUER_ADDRESS_MISSING", thrown.getReason());
    // Propagating the exception out of the @Transactional method is what rolls the invoice back.
    assertEquals(0, TransactionSynchronizationManager.getSynchronizations().size());
    verify(queue, never()).enqueue(anyLong(), anyLong(), anyInt(), any(), anyString());
    verify(invoiceService, never()).getInvoice(anyLong(), anyLong());
  }

  @Test
  void issueWithSifen_enqueuesOnlyAfterCommit() {
    InvoiceResponse result = service.issueWithSifen(TENANT_ID, request);

    assertEquals(finalResponse, result);
    verify(submissionService).prepareAndSign(TENANT_ID, INVOICE_ID);
    verify(queue, never()).enqueue(anyLong(), anyLong(), anyInt(), any(), anyString());

    TransactionSynchronizationManager.getSynchronizations()
        .forEach(TransactionSynchronization::afterCommit);

    verify(queue).enqueue(eq(TENANT_ID), eq(INVOICE_ID), eq(1), eq(Duration.ZERO), anyString());
  }

  @Test
  void issueWithSifen_doesNotEnqueueWhenTransactionRollsBackAfterSigning() {
    service.issueWithSifen(TENANT_ID, request);

    TransactionSynchronizationManager.getSynchronizations()
        .forEach(s -> s.afterCompletion(TransactionSynchronization.STATUS_ROLLED_BACK));

    verify(queue, never()).enqueue(anyLong(), anyLong(), anyInt(), any(), anyString());
  }

  @Test
  void correctAndResendWithSifen_propagatesSigningFailureAndNeverEnqueues() {
    InvoiceCorrectionRequest correction = mock(InvoiceCorrectionRequest.class);
    doThrow(
            new ResponseStatusException(
                HttpStatus.PRECONDITION_FAILED, "SIFEN_ISSUER_ADDRESS_MISSING"))
        .when(submissionService)
        .prepareAndSign(TENANT_ID, INVOICE_ID);

    assertThrows(
        ResponseStatusException.class,
        () -> service.correctAndResendWithSifen(TENANT_ID, INVOICE_ID, correction));

    verify(invoiceService).correctAndResendInvoice(TENANT_ID, INVOICE_ID, correction);
    verify(queue, never()).enqueue(anyLong(), anyLong(), anyInt(), any(), anyString());
  }

  @Test
  void correctAndResendWithSifen_enqueuesOnlyAfterCommit() {
    InvoiceCorrectionRequest correction = mock(InvoiceCorrectionRequest.class);

    InvoiceResponse result = service.correctAndResendWithSifen(TENANT_ID, INVOICE_ID, correction);

    assertEquals(finalResponse, result);
    verify(queue, never()).enqueue(anyLong(), anyLong(), anyInt(), any(), anyString());
    TransactionSynchronizationManager.getSynchronizations()
        .forEach(TransactionSynchronization::afterCommit);
    verify(queue).enqueue(eq(TENANT_ID), eq(INVOICE_ID), eq(1), eq(Duration.ZERO), anyString());
  }

  @Test
  void issueWithSifen_enqueueFailureAfterCommitDoesNotPropagate() {
    doThrow(new IllegalStateException("service bus down"))
        .when(queue)
        .enqueue(anyLong(), anyLong(), anyInt(), any(), anyString());

    service.issueWithSifen(TENANT_ID, request);

    TransactionSynchronizationManager.getSynchronizations()
        .forEach(TransactionSynchronization::afterCommit);
    verify(queue).enqueue(eq(TENANT_ID), eq(INVOICE_ID), eq(1), eq(Duration.ZERO), anyString());
  }
}
