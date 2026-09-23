package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.SifenNumberVoidingEvent;
import com.cursorpoc.backend.domain.enums.SifenNumberVoidingStatus;
import com.cursorpoc.backend.service.SifenDocumentType;
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

  long deleteByTenantId(long tenantId);

  List<SifenNumberVoidingEvent> findByTenantIdAndStatus(
      long tenantId, SifenNumberVoidingStatus status);

  List<SifenNumberVoidingEvent> findByTenantIdAndFiscalStamp_Id(long tenantId, long fiscalStampId);

  /**
   * Issue #205 AC-1/AC-4: events (of any status) whose own range fully covers {@code [rangeFrom,
   * rangeTo]} — i.e. {@code event.rangeFrom <= rangeFrom AND event.rangeTo >= rangeTo} — restricted
   * to a status subset. Used both to skip already-voided numbers at emission time (a single-number
   * range) and to detect a {@code PENDING}/{@code REJECTED} event superseded by a
   * separately-approved covering range.
   */
  List<SifenNumberVoidingEvent>
      findByTenantIdAndFiscalStamp_IdAndDocumentTypeAndStatusInAndRangeFromLessThanEqualAndRangeToGreaterThanEqual(
          long tenantId,
          long fiscalStampId,
          SifenDocumentType documentType,
          List<SifenNumberVoidingStatus> statuses,
          int rangeFrom,
          int rangeTo);
}
