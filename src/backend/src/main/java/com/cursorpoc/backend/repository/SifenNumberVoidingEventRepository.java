package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.SifenNumberVoidingEvent;
import com.cursorpoc.backend.domain.enums.SifenNumberVoidingStatus;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SifenNumberVoidingEventRepository
    extends JpaRepository<SifenNumberVoidingEvent, Long> {

  List<SifenNumberVoidingEvent> findByTenantIdOrderByDeadlineDateAsc(long tenantId);

  Optional<SifenNumberVoidingEvent> findByInvoiceId(long invoiceId);

  Optional<SifenNumberVoidingEvent> findByIdAndTenantId(long id, long tenantId);

  List<SifenNumberVoidingEvent> findByTenantIdAndStatus(
      long tenantId, SifenNumberVoidingStatus status);

  List<SifenNumberVoidingEvent> findByTenantIdAndFiscalStamp_Id(long tenantId, long fiscalStampId);
}
