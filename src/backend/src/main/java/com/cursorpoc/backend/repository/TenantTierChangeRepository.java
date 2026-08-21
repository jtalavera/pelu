package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.TenantTierChange;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TenantTierChangeRepository extends JpaRepository<TenantTierChange, Long> {

  Optional<TenantTierChange> findByTenantId(Long tenantId);
}
