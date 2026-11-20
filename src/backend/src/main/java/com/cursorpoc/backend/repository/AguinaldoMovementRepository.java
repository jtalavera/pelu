package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.AguinaldoMovement;
import java.math.BigDecimal;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface AguinaldoMovementRepository extends JpaRepository<AguinaldoMovement, Long> {

  List<AguinaldoMovement> findByTenantIdAndProfessionalIdOrderByOccurredOnAscIdAsc(
      Long tenantId, Long professionalId);

  List<AguinaldoMovement> findByTenantIdOrderByOccurredOnAscIdAsc(Long tenantId);

  @Query(
      "SELECT COALESCE(SUM(m.amount), 0) FROM AguinaldoMovement m"
          + " WHERE m.tenantId = :tenantId AND m.professionalId = :professionalId")
  BigDecimal sumByProfessional(
      @Param("tenantId") long tenantId, @Param("professionalId") long professionalId);
}
