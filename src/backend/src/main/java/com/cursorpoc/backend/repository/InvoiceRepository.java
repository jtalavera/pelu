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

  List<Invoice> findByTenant_IdAndIssuedAtBetweenOrderByIssuedAtDesc(
      Long tenantId, Instant from, Instant to);

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
}
