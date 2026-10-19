package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.CommissionRecalculation;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CommissionRecalculationRepository
    extends JpaRepository<CommissionRecalculation, Long> {

  List<CommissionRecalculation> findByTenantIdOrderByCreatedAtDescIdDesc(long tenantId);
}
