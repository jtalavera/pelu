package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.TipWithdrawal;
import java.math.BigDecimal;
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
}
