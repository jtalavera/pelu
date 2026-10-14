package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.CommissionSettlement;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CommissionSettlementRepository extends JpaRepository<CommissionSettlement, Long> {

  Optional<CommissionSettlement> findByIdAndTenantId(long id, long tenantId);

  List<CommissionSettlement> findByTenantIdOrderByPeriodFromDescIdDesc(long tenantId);

  List<CommissionSettlement> findByTenantIdAndProfessionalIdOrderByPeriodFromDescIdDesc(
      long tenantId, long professionalId);
}
