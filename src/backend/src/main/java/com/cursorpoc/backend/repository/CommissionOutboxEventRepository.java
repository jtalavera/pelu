package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.CommissionOutboxEvent;
import com.cursorpoc.backend.domain.enums.CommissionOutboxStatus;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CommissionOutboxEventRepository
    extends JpaRepository<CommissionOutboxEvent, Long> {

  List<CommissionOutboxEvent> findTop100ByStatusOrderByIdAsc(CommissionOutboxStatus status);

  List<CommissionOutboxEvent> findByTenantIdAndInvoiceIdAndStatusOrderByIdAsc(
      long tenantId, long invoiceId, CommissionOutboxStatus status);
}
