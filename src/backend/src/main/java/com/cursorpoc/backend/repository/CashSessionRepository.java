package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.CashSession;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface CashSessionRepository extends JpaRepository<CashSession, Long> {

  Optional<CashSession> findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(Long tenantId);

  Optional<CashSession> findByIdAndTenant_Id(Long id, Long tenantId);

  Page<CashSession> findByTenant_IdOrderByOpenedAtDesc(Long tenantId, Pageable pageable);

  /**
   * Issue: Historial de cajas filters (date range / open-closed / opened-or-closed-by search).
   * {@code closedByUser} is nullable (still-open sessions), so it's joined explicitly with LEFT
   * JOIN — an implicit path reference in the WHERE clause would render as an INNER JOIN and
   * silently drop every open session from the results.
   */
  @Query(
      """
      SELECT cs FROM CashSession cs
      LEFT JOIN cs.closedByUser cbu
      WHERE cs.tenant.id = :tenantId
      AND (:fromDate IS NULL OR cs.openedAt >= :fromDate)
      AND (:toDate IS NULL OR cs.openedAt <= :toDate)
      AND (:status IS NULL
           OR (:status = 'OPEN' AND cs.closedAt IS NULL)
           OR (:status = 'CLOSED' AND cs.closedAt IS NOT NULL))
      AND (:q IS NULL
           OR LOWER(cs.openedByUser.email) LIKE LOWER(CONCAT('%', :q, '%'))
           OR LOWER(cbu.email) LIKE LOWER(CONCAT('%', :q, '%')))
      ORDER BY cs.openedAt DESC
      """)
  Page<CashSession> findByTenantWithFiltersPaged(
      @Param("tenantId") Long tenantId,
      @Param("fromDate") Instant fromDate,
      @Param("toDate") Instant toDate,
      @Param("status") String status,
      @Param("q") String q,
      Pageable pageable);

  @Query(
      """
      SELECT p.method, COALESCE(SUM(p.amount), 0)
      FROM InvoicePaymentAllocation p
      JOIN p.invoice i
      WHERE i.cashSession.id = :cashSessionId AND i.status = 'ISSUED'
      GROUP BY p.method
      """)
  List<Object[]> sumPaymentsByMethodForSession(@Param("cashSessionId") Long cashSessionId);

  @Query(
      """
      SELECT m.type, COALESCE(SUM(m.amount), 0)
      FROM CashMovement m
      WHERE m.cashSession.id = :cashSessionId
      GROUP BY m.type
      """)
  List<Object[]> sumMovementsByTypeForSession(@Param("cashSessionId") Long cashSessionId);

  long deleteByTenant_Id(Long tenantId);
}
