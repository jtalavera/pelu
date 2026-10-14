package com.cursorpoc.backend.commission;

import com.cursorpoc.backend.domain.CommissionEntry;
import com.cursorpoc.backend.domain.CommissionOutboxEvent;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.InvoiceLine;
import com.cursorpoc.backend.domain.enums.CommissionOutboxStatus;
import com.cursorpoc.backend.domain.enums.InvoiceStatus;
import com.cursorpoc.backend.repository.CommissionEntryRepository;
import com.cursorpoc.backend.repository.CommissionOutboxEventRepository;
import com.cursorpoc.backend.repository.InvoiceRepository;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * HU-COM-04 (accrual on issue) and HU-COM-05 (reversal on void / SIFEN correction). Processes the
 * {@code commission_outbox} rows of an invoice in order, each in its own transaction.
 */
@Service
public class CommissionAccrualService {

  private static final Logger log = LoggerFactory.getLogger(CommissionAccrualService.class);
  static final int MAX_ATTEMPTS = 10;

  private final CommissionOutboxEventRepository outboxRepository;
  private final CommissionEntryRepository entryRepository;
  private final InvoiceRepository invoiceRepository;
  private final CommissionLedger ledger;
  private final TransactionTemplate requiresNew;

  public CommissionAccrualService(
      CommissionOutboxEventRepository outboxRepository,
      CommissionEntryRepository entryRepository,
      InvoiceRepository invoiceRepository,
      CommissionLedger ledger,
      PlatformTransactionManager transactionManager) {
    this.outboxRepository = outboxRepository;
    this.entryRepository = entryRepository;
    this.invoiceRepository = invoiceRepository;
    this.ledger = ledger;
    this.requiresNew = new TransactionTemplate(transactionManager);
    this.requiresNew.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
  }

  /** After-commit entry point: never throws. */
  public void processInvoiceSafely(long tenantId, long invoiceId) {
    List<CommissionOutboxEvent> pending =
        outboxRepository.findByTenantIdAndInvoiceIdAndStatusOrderByIdAsc(
            tenantId, invoiceId, CommissionOutboxStatus.PENDING);
    for (CommissionOutboxEvent row : pending) {
      if (!processRowSafely(row.getId())) {
        return; // keep order: later events of this invoice wait for the failed one
      }
    }
  }

  /** Processes one outbox row; returns false when it failed (left PENDING / FAILED). */
  public boolean processRowSafely(long outboxId) {
    try {
      requiresNew.executeWithoutResult(status -> processRow(outboxId));
      return true;
    } catch (RuntimeException ex) {
      log.error(
          "Commission outbox id={} error=COMMISSION_CALCULATION_FAILED message={}",
          outboxId,
          ex.getMessage(),
          ex);
      requiresNew.executeWithoutResult(
          status ->
              outboxRepository
                  .findById(outboxId)
                  .ifPresent(
                      row -> {
                        row.setAttemptCount(row.getAttemptCount() + 1);
                        row.setLastError(truncate("COMMISSION_CALCULATION_FAILED: " + ex));
                        if (row.getAttemptCount() >= MAX_ATTEMPTS) {
                          row.setStatus(CommissionOutboxStatus.FAILED);
                        }
                      }));
      return false;
    }
  }

  private void processRow(long outboxId) {
    CommissionOutboxEvent row = outboxRepository.findById(outboxId).orElseThrow();
    if (row.getStatus() != CommissionOutboxStatus.PENDING) {
      return;
    }
    Invoice invoice = invoiceRepository.findById(row.getInvoiceId()).orElse(null);
    if (invoice != null) {
      switch (row.getEventKind()) {
        case "ISSUED" -> accrue(invoice);
        case "VOIDED" -> reverseAll(invoice, CommissionLedger.REASON_VOID);
        case "CORRECTED" -> {
          reverseAll(invoice, CommissionLedger.REASON_CORRECTION);
          if (invoice.getStatus() != InvoiceStatus.VOIDED) {
            accrue(invoice);
          }
        }
        default -> log.warn("Unknown commission outbox kind {}", row.getEventKind());
      }
    }
    row.setAttemptCount(row.getAttemptCount() + 1);
    row.setStatus(CommissionOutboxStatus.DONE);
    row.setProcessedAt(Instant.now());
  }

  /** One INVOICE_LINE entry per line with beneficiary and catalog item; idempotent per line. */
  void accrue(Invoice invoice) {
    long tenantId = invoice.getTenant().getId();
    Set<Long> alreadyAccrued = new HashSet<>();
    for (CommissionEntry e :
        entryRepository.findLiveLineEntriesOfInvoice(tenantId, invoice.getId())) {
      alreadyAccrued.add(e.getInvoiceLineId());
    }
    CommissionConfigSnapshot snapshot = ledger.snapshot(tenantId);
    Instant at = invoice.getIssuedAt() != null ? invoice.getIssuedAt() : Instant.now();
    for (InvoiceLine line : invoice.getLines()) {
      if (line.getProfessional() == null
          || line.getSalonService() == null
          || alreadyAccrued.contains(line.getId())) {
        continue; // no beneficiary / free-text line → no commission (C17)
      }
      CommissionLedger.LineInput input =
          new CommissionLedger.LineInput(
              tenantId,
              line.getProfessional().getId(),
              invoice.getId(),
              line.getId(),
              formatNumber(invoice),
              line.getSalonService().getId(),
              line.getSalonService().getName(),
              line.getSalonService().getKind(),
              line.getLineTotal(),
              line.getTaxAmount());
      ledger.save(ledger.computeLineEntry(snapshot, input, at, 1), null, null);
    }
  }

  /**
   * HU-COM-05: each live entry is compensated. Unsettled or Draft → same settlement and accrual as
   * the original (they cancel out). Approved / Paid → unsettled negative adjustment for the next
   * settlement (accrued now).
   */
  void reverseAll(Invoice invoice, String reason) {
    long tenantId = invoice.getTenant().getId();
    Instant now = Instant.now();
    for (CommissionEntry e :
        entryRepository.findLiveLineEntriesOfInvoice(tenantId, invoice.getId())) {
      if (ledger.isClosed(e.getSettlementId())) {
        ledger.reverse(e, reason, now, null, null, null);
      } else {
        ledger.reverse(e, reason, e.getAccrualAt(), e.getSettlementId(), null, null);
      }
    }
  }

  static String formatNumber(Invoice invoice) {
    return String.format("%07d", invoice.getInvoiceNumber());
  }

  private static String truncate(String s) {
    return s.length() > 2000 ? s.substring(0, 2000) : s;
  }
}
