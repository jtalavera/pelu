package com.cursorpoc.backend.service;

import com.cursorpoc.backend.web.dto.InvoiceCorrectionRequest;
import com.cursorpoc.backend.web.dto.InvoiceCreateRequest;
import com.cursorpoc.backend.web.dto.InvoiceResponse;
import java.time.Duration;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * Atomic invoice emission and correction when SIFEN is enabled for the tenant.
 *
 * <p>Creating the invoice and signing it for SIFEN (CDC/QR, issuer-data validation) run in <b>one
 * database transaction</b>: if anything in the SIFEN preparation fails — e.g. the issuer's
 * address/phone/email is not configured ({@code SIFEN_ISSUER_*}) — everything is rolled back: no
 * invoice row, the timbrado number is not consumed, the ficha stays open and no stock outbox row is
 * written.
 *
 * <p>The transmit message is only enqueued after the transaction commits, so the async consumer can
 * never receive a message for an invoice that was rolled back. No call to SIFEN happens here (RT-20
 * — transmission stays on the consumer thread, see {@link SifenInvoiceSubmissionService}).
 */
@Service
public class InvoiceIssuanceService {

  private static final Logger log = LoggerFactory.getLogger(InvoiceIssuanceService.class);

  private final InvoiceService invoiceService;
  private final SifenInvoiceSubmissionService sifenInvoiceSubmissionService;
  private final SifenSubmissionQueue sifenSubmissionQueue;

  public InvoiceIssuanceService(
      InvoiceService invoiceService,
      SifenInvoiceSubmissionService sifenInvoiceSubmissionService,
      SifenSubmissionQueue sifenSubmissionQueue) {
    this.invoiceService = invoiceService;
    this.sifenInvoiceSubmissionService = sifenInvoiceSubmissionService;
    this.sifenSubmissionQueue = sifenSubmissionQueue;
  }

  @Transactional
  public InvoiceResponse issueWithSifen(long tenantId, InvoiceCreateRequest request) {
    InvoiceResponse issued = invoiceService.issueInvoice(tenantId, request);
    long invoiceId = issued.id();
    sifenInvoiceSubmissionService.prepareAndSign(tenantId, invoiceId);
    enqueueAfterCommit(tenantId, invoiceId);
    return invoiceService.getInvoice(tenantId, invoiceId);
  }

  /**
   * Issue #175 correct-and-resend, atomic: the wipe of the rejected content, the re-derivation and
   * the re-signing share one transaction, so a failure while re-signing (e.g. incomplete issuer
   * data) leaves the invoice exactly as it was — still {@code REJECTED}, with its original lines,
   * payments and inutilización — instead of half-corrected with its SIFEN result already cleared.
   */
  @Transactional
  public InvoiceResponse correctAndResendWithSifen(
      long tenantId, long invoiceId, InvoiceCorrectionRequest request) {
    invoiceService.correctAndResendInvoice(tenantId, invoiceId, request);
    sifenInvoiceSubmissionService.prepareAndSign(tenantId, invoiceId);
    enqueueAfterCommit(tenantId, invoiceId);
    return invoiceService.getInvoice(tenantId, invoiceId);
  }

  private void enqueueAfterCommit(long tenantId, long invoiceId) {
    String correlationId = UUID.randomUUID().toString();
    if (!TransactionSynchronizationManager.isSynchronizationActive()) {
      sifenSubmissionQueue.enqueue(tenantId, invoiceId, 1, Duration.ZERO, correlationId);
      return;
    }
    TransactionSynchronizationManager.registerSynchronization(
        new TransactionSynchronization() {
          @Override
          public void afterCommit() {
            // The invoice is already committed (QUEUED): a failed enqueue must not surface as a
            // 500 (the user would retry and issue a duplicate). SifenSubmissionReconciler
            // re-enqueues QUEUED invoices whose next attempt is due.
            try {
              sifenSubmissionQueue.enqueue(tenantId, invoiceId, 1, Duration.ZERO, correlationId);
            } catch (RuntimeException e) {
              log.error(
                  "SIFEN enqueue after commit failed tenantId={} invoiceId={}; the reconciler will"
                      + " pick it up",
                  tenantId,
                  invoiceId,
                  e);
            }
          }
        });
  }
}
