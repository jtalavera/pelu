package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.InvoiceTip;
import com.cursorpoc.backend.domain.enums.InvoiceStatus;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Tips entered on the comprobante form; only invoices in {@code status} (ISSUED) count. */
public interface InvoiceTipRepository extends JpaRepository<InvoiceTip, Long> {

  /**
   * {@code professionalIds} must be non-empty; callers resolve "no filter" to all tenant
   * professional ids.
   */
  @Query(
      """
      SELECT t FROM InvoiceTip t
      JOIN FETCH t.invoice i
      LEFT JOIN FETCH i.client c
      JOIN FETCH t.professional p
      WHERE i.tenant.id = :tenantId
      AND i.status = :status
      AND (:fromDate IS NULL OR i.issuedAt >= :fromDate)
      AND (:toDate IS NULL OR i.issuedAt <= :toDate)
      AND p.id IN :professionalIds
      AND t.amount > 0
      ORDER BY p.fullName ASC, i.issuedAt ASC
      """)
  List<InvoiceTip> findForReport(
      @Param("tenantId") Long tenantId,
      @Param("status") InvoiceStatus status,
      @Param("fromDate") Instant fromDate,
      @Param("toDate") Instant toDate,
      @Param("professionalIds") List<Long> professionalIds);

  @Query(
      """
      SELECT COALESCE(SUM(t.amount), 0) FROM InvoiceTip t
      WHERE t.invoice.tenant.id = :tenantId
      AND t.invoice.status = :status
      AND t.professional.id = :professionalId
      """)
  BigDecimal sumForProfessional(
      @Param("tenantId") Long tenantId,
      @Param("professionalId") Long professionalId,
      @Param("status") InvoiceStatus status);
}
