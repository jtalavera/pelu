package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.SifenNumberVoidingEvent;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SifenNumberVoidingEventRepository
    extends JpaRepository<SifenNumberVoidingEvent, Long> {

  List<SifenNumberVoidingEvent> findByTenantIdOrderByDeadlineDateAsc(long tenantId);

  Optional<SifenNumberVoidingEvent> findByInvoiceId(long invoiceId);

  Optional<SifenNumberVoidingEvent> findByIdAndTenantId(long id, long tenantId);
}
