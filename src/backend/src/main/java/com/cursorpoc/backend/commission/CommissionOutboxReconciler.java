package com.cursorpoc.backend.commission;

import com.cursorpoc.backend.domain.CommissionOutboxEvent;
import com.cursorpoc.backend.domain.enums.CommissionOutboxStatus;
import com.cursorpoc.backend.repository.CommissionOutboxEventRepository;
import java.util.HashSet;
import java.util.Set;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** HU-COM-04: retries commission outbox rows left PENDING (e.g. a calculation failure). */
@Component
public class CommissionOutboxReconciler {

  private final CommissionOutboxEventRepository outboxRepository;
  private final CommissionAccrualService accrualService;

  public CommissionOutboxReconciler(
      CommissionOutboxEventRepository outboxRepository, CommissionAccrualService accrualService) {
    this.outboxRepository = outboxRepository;
    this.accrualService = accrualService;
  }

  @Scheduled(fixedDelayString = "${app.femme.commissions.reconcile-delay-ms:60000}")
  public void reconcile() {
    Set<Long> blockedInvoices = new HashSet<>();
    for (CommissionOutboxEvent row :
        outboxRepository.findTop100ByStatusOrderByIdAsc(CommissionOutboxStatus.PENDING)) {
      if (blockedInvoices.contains(row.getInvoiceId())) {
        continue;
      }
      if (!accrualService.processRowSafely(row.getId())) {
        blockedInvoices.add(row.getInvoiceId());
      }
    }
  }
}
