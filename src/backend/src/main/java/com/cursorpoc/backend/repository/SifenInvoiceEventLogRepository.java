package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.SifenInvoiceEventLog;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SifenInvoiceEventLogRepository extends JpaRepository<SifenInvoiceEventLog, Long> {

  List<SifenInvoiceEventLog> findByTenantIdAndInvoiceIdOrderByOccurredAtDesc(
      long tenantId, long invoiceId);
}
