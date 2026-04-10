package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.CashSession;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface CashSessionRepository extends JpaRepository<CashSession, Long> {

  Optional<CashSession> findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(Long tenantId);

  Optional<CashSession> findByIdAndTenant_Id(Long id, Long tenantId);

  @Query(
      """
      SELECT p.method, COALESCE(SUM(p.amount), 0)
      FROM InvoicePaymentAllocation p
      JOIN p.invoice i
      WHERE i.cashSession.id = :cashSessionId AND i.status = 'ISSUED'
      GROUP BY p.method
      """)
  List<Object[]> sumPaymentsByMethodForSession(@Param("cashSessionId") Long cashSessionId);
}
