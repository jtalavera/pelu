package com.cursorpoc.backend.commission;

import com.cursorpoc.backend.domain.CommissionOutboxEvent;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.enums.CommissionOutboxStatus;
import com.cursorpoc.backend.repository.CommissionEntryRepository;
import com.cursorpoc.backend.repository.CommissionOutboxEventRepository;
import com.cursorpoc.backend.stock.InvoiceStockEvent;
import java.time.Instant;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * HU-COM-04/05: every invoice issue, void (any path) and SIFEN correction publishes an {@link
 * InvoiceStockEvent} inside its transaction. Here we only record an outbox row in that same
 * transaction; the calculation runs after commit in its own transaction, so a commission problem
 * never blocks the invoice (failures stay PENDING for {@link CommissionOutboxReconciler}).
 */
@Component
public class CommissionInvoiceListener {

  private final CommissionAccess access;
  private final CommissionOutboxEventRepository outboxRepository;
  private final CommissionEntryRepository entryRepository;
  private final CommissionAccrualService accrualService;

  public CommissionInvoiceListener(
      CommissionAccess access,
      CommissionOutboxEventRepository outboxRepository,
      CommissionEntryRepository entryRepository,
      CommissionAccrualService accrualService) {
    this.access = access;
    this.outboxRepository = outboxRepository;
    this.entryRepository = entryRepository;
    this.accrualService = accrualService;
  }

  @EventListener
  public void onInvoiceEvent(InvoiceStockEvent event) {
    Invoice invoice = event.invoice();
    if (invoice == null || invoice.getId() == null || invoice.getTenant() == null) {
      return;
    }
    long tenantId = invoice.getTenant().getId();
    boolean enabled = access.isEnabled(tenantId);
    // C20: invoices issued while the module is off never accrue. Reversals of existing entries
    // are still recorded (C9: data is kept consistent while the flag is off).
    boolean hasEntries =
        !entryRepository
            .findByTenantIdAndInvoiceIdOrderByIdAsc(tenantId, invoice.getId())
            .isEmpty();
    if (event.kind() == InvoiceStockEvent.Kind.ISSUED && !enabled) {
      return;
    }
    if (event.kind() != InvoiceStockEvent.Kind.ISSUED && !enabled && !hasEntries) {
      return;
    }
    CommissionOutboxEvent row = new CommissionOutboxEvent();
    row.setTenantId(tenantId);
    row.setInvoiceId(invoice.getId());
    row.setEventKind(event.kind().name());
    row.setStatus(CommissionOutboxStatus.PENDING);
    row.setAttemptCount(0);
    row.setCreatedAt(Instant.now());
    outboxRepository.save(row);

    long invoiceId = invoice.getId();
    if (TransactionSynchronizationManager.isSynchronizationActive()) {
      TransactionSynchronizationManager.registerSynchronization(
          new TransactionSynchronization() {
            @Override
            public void afterCommit() {
              accrualService.processInvoiceSafely(tenantId, invoiceId);
            }
          });
    }
  }
}
