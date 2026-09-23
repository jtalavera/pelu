package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.TenantFeatureFlagChange;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TenantFeatureFlagChangeRepository
    extends JpaRepository<TenantFeatureFlagChange, Long> {

  Optional<TenantFeatureFlagChange> findByTenantIdAndFlagKey(long tenantId, String flagKey);
}
