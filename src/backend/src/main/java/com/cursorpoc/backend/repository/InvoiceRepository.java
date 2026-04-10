package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.enums.InvoiceStatus;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface InvoiceRepository extends JpaRepository<Invoice, Long> {

  Optional<Invoice> findByIdAndTenant_Id(Long id, Long tenantId);

  boolean existsByTenant_IdAndFiscalStamp_Id(Long tenantId, Long fiscalStampId);

  List<Invoice> findByTenant_IdAndIssuedAtBetweenOrderByIssuedAtDesc(
      Long tenantId, Instant from, Instant to);

  @Query(
      """
      SELECT i FROM Invoice i
      WHERE i.tenant.id = :tenantId
      AND (:fromDate IS NULL OR i.issuedAt >= :fromDate)
      AND (:toDate IS NULL OR i.issuedAt <= :toDate)
      AND (:clientId IS NULL OR i.client.id = :clientId)
      AND (:status IS NULL OR i.status = :status)
      ORDER BY i.issuedAt DESC
      """)
  List<Invoice> findByTenantWithFilters(
      @Param("tenantId") Long tenantId,
      @Param("fromDate") Instant fromDate,
      @Param("toDate") Instant toDate,
      @Param("clientId") Long clientId,
      @Param("status") InvoiceStatus status);

  @Query(
      """
      SELECT COALESCE(MAX(i.invoiceNumber), 0) FROM Invoice i
      WHERE i.tenant.id = :tenantId AND i.fiscalStamp.id = :fiscalStampId
      """)
  int findMaxInvoiceNumberByTenantAndFiscalStamp(
      @Param("tenantId") Long tenantId, @Param("fiscalStampId") Long fiscalStampId);

  List<Invoice> findByCashSession_IdAndTenant_Id(Long cashSessionId, Long tenantId);

  @Query(
      """
      SELECT COALESCE(SUM(i.total), 0) FROM Invoice i
      WHERE i.tenant.id = :tenantId AND i.status = :status
      AND i.issuedAt >= :from AND i.issuedAt < :to
      """)
  BigDecimal sumTotalByTenantAndStatusAndIssuedBetween(
      @Param("tenantId") Long tenantId,
      @Param("status") InvoiceStatus status,
      @Param("from") Instant from,
      @Param("to") Instant to);

  @Query(
      """
      SELECT COALESCE(SUM(p.amount), 0) FROM InvoicePaymentAllocation p
      JOIN p.invoice i
      WHERE i.tenant.id = :tenantId AND i.status = :status
      AND i.issuedAt >= :from AND i.issuedAt < :to
      """)
  BigDecimal sumPaymentsByTenantAndStatusAndIssuedBetween(
      @Param("tenantId") Long tenantId,
      @Param("status") InvoiceStatus status,
      @Param("from") Instant from,
      @Param("to") Instant to);

  @Query(
      """
      SELECT COALESCE(SUM(i.total), 0) FROM Invoice i
      WHERE i.cashSession.id = :cashSessionId AND i.status = :status
      """)
  BigDecimal sumTotalByCashSessionAndStatus(
      @Param("cashSessionId") Long cashSessionId, @Param("status") InvoiceStatus status);

  @Query(
      """
      SELECT COUNT(i) FROM Invoice i
      WHERE i.cashSession.id = :cashSessionId AND i.status = :status
      """)
  long countByCashSessionAndStatus(
      @Param("cashSessionId") Long cashSessionId, @Param("status") InvoiceStatus status);
}
