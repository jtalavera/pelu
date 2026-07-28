package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.TipWithdrawal;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface TipWithdrawalRepository extends JpaRepository<TipWithdrawal, Long> {

  Page<TipWithdrawal> findByTenant_IdAndProfessional_IdOrderByWithdrawnAtDesc(
      Long tenantId, Long professionalId, Pageable pageable);

  @Query(
      """
      SELECT COALESCE(SUM(w.amount), 0) FROM TipWithdrawal w
      WHERE w.tenant.id = :tenantId
      AND w.professional.id = :professionalId
      """)
  BigDecimal sumForProfessional(
      @Param("tenantId") Long tenantId, @Param("professionalId") Long professionalId);

  /**
   * Withdrawals within the report's own date window, so the report's per-professional totals net
   * out the same withdrawals a user just made — mirrors {@code
   * ServiceRecordTipRepository#findForReport}'s date-window semantics.
   */
  @Query(
      """
      SELECT w FROM TipWithdrawal w
      JOIN FETCH w.professional p
      WHERE w.tenant.id = :tenantId
      AND (:fromDate IS NULL OR w.withdrawnAt >= :fromDate)
      AND (:toDate IS NULL OR w.withdrawnAt <= :toDate)
      AND p.id IN :professionalIds
      """)
  List<TipWithdrawal> findForReport(
      @Param("tenantId") Long tenantId,
      @Param("fromDate") Instant fromDate,
      @Param("toDate") Instant toDate,
      @Param("professionalIds") List<Long> professionalIds);
}
