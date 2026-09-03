package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.SifenNumberVoidingEvent;
import com.cursorpoc.backend.domain.enums.SifenNumberVoidingStatus;
import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SifenNumberVoidingEventRepository
    extends JpaRepository<SifenNumberVoidingEvent, Long> {

  /**
   * Issue #194: the "Numeración inutilizada" tab paginates this list like the invoice history. The
   * caller supplies the sort (deadline asc, then newest first) via the {@link Pageable}.
   */
  Page<SifenNumberVoidingEvent> findByTenantId(long tenantId, Pageable pageable);

  Optional<SifenNumberVoidingEvent> findByInvoiceId(long invoiceId);

  Optional<SifenNumberVoidingEvent> findByIdAndTenantId(long id, long tenantId);

  List<SifenNumberVoidingEvent> findByTenantIdAndStatus(
      long tenantId, SifenNumberVoidingStatus status);

  List<SifenNumberVoidingEvent> findByTenantIdAndFiscalStamp_Id(long tenantId, long fiscalStampId);
}
