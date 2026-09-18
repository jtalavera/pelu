package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.CashSession;
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
