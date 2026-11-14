package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.CommissionGroup;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CommissionGroupRepository extends JpaRepository<CommissionGroup, Long> {

  List<CommissionGroup> findByTenantIdOrderByNameAsc(Long tenantId);

  Optional<CommissionGroup> findByIdAndTenantId(Long id, Long tenantId);

  boolean existsByTenantIdAndNameIgnoreCase(Long tenantId, String name);
}
