package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.InvoiceLateTip;
import com.cursorpoc.backend.domain.enums.InvoiceStatus;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Tips left after the invoice was issued. Voided ones never count, and neither do the ones of an
 * invoice that was later voided (same rule as the tips entered on the comprobante).
 */
public interface InvoiceLateTipRepository extends JpaRepository<InvoiceLateTip, Long> {

  @Query(
      """
      SELECT t FROM InvoiceLateTip t
      JOIN FETCH t.professional
      JOIN FETCH t.invoice i
      JOIN FETCH t.cashSession
      LEFT JOIN FETCH t.createdBy
      LEFT JOIN FETCH t.voidedBy
      WHERE t.id = :id AND t.tenant.id = :tenantId
      """)
  Optional<InvoiceLateTip> findByIdAndTenant(
      @Param("id") Long id, @Param("tenantId") Long tenantId);

  /** All the late tips of an invoice (voided ones included), oldest first. */
  @Query(
      """
      SELECT t FROM InvoiceLateTip t
      JOIN FETCH t.professional
      JOIN FETCH t.invoice
      JOIN FETCH t.cashSession
      LEFT JOIN FETCH t.createdBy
      LEFT JOIN FETCH t.voidedBy
      WHERE t.invoice.id = :invoiceId AND t.tenant.id = :tenantId
      ORDER BY t.createdAt ASC, t.id ASC
      """)
  List<InvoiceLateTip> findByInvoice(
      @Param("invoiceId") Long invoiceId, @Param("tenantId") Long tenantId);

  /**
   * Late tips that entered a cash session (voided ones included, so the register can list them).
   */
  @Query(
      """
      SELECT t FROM InvoiceLateTip t
      JOIN FETCH t.professional
      JOIN FETCH t.invoice
      LEFT JOIN FETCH t.createdBy
      LEFT JOIN FETCH t.voidedBy
      WHERE t.cashSession.id = :cashSessionId AND t.tenant.id = :tenantId
      ORDER BY t.createdAt ASC, t.id ASC
      """)
  List<InvoiceLateTip> findByCashSession(
      @Param("cashSessionId") Long cashSessionId, @Param("tenantId") Long tenantId);

  @Query(
      """
      SELECT COALESCE(SUM(t.amount), 0) FROM InvoiceLateTip t
      WHERE t.tenant.id = :tenantId
      AND t.professional.id = :professionalId
      AND t.voidedAt IS NULL
      AND t.invoice.status = :status
      """)
  BigDecimal sumForProfessional(
      @Param("tenantId") Long tenantId,
      @Param("professionalId") Long professionalId,
      @Param("status") InvoiceStatus status);

  /** Per-method totals of the counting (not voided) late tips of a cash session. */
  @Query(
      """
      SELECT t.paymentMethod, COALESCE(SUM(t.amount), 0) FROM InvoiceLateTip t
      WHERE t.cashSession.id = :cashSessionId
      AND t.voidedAt IS NULL
      AND t.invoice.status = :status
      GROUP BY t.paymentMethod
      """)
  List<Object[]> sumByMethodForSession(
      @Param("cashSessionId") Long cashSessionId, @Param("status") InvoiceStatus status);

  /**
   * Late tips (voided ones included, so Movimientos can show them as «Anulada») of the report's
   * date window, for issued invoices. {@code professionalIds} must be non-empty.
   */
  @Query(
      """
      SELECT t FROM InvoiceLateTip t
      JOIN FETCH t.professional p
      JOIN FETCH t.invoice i
      LEFT JOIN FETCH t.createdBy
      LEFT JOIN FETCH t.voidedBy
      WHERE t.tenant.id = :tenantId
      AND i.status = :status
      AND (:fromDate IS NULL OR t.createdAt >= :fromDate)
      AND (:toDate IS NULL OR t.createdAt <= :toDate)
      AND p.id IN :professionalIds
      ORDER BY p.fullName ASC, t.createdAt ASC
      """)
  List<InvoiceLateTip> findForReport(
      @Param("tenantId") Long tenantId,
      @Param("status") InvoiceStatus status,
      @Param("fromDate") Instant fromDate,
      @Param("toDate") Instant toDate,
      @Param("professionalIds") List<Long> professionalIds);

  long deleteByTenant_Id(Long tenantId);
}
