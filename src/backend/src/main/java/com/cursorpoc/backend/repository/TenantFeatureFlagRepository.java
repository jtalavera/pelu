package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.TenantFeatureFlag;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TenantFeatureFlagRepository extends JpaRepository<TenantFeatureFlag, Long> {

  Optional<TenantFeatureFlag> findByTenantIdAndFlagKey(long tenantId, String flagKey);

  List<TenantFeatureFlag> findAllByTenantIdOrderByFlagKeyAsc(long tenantId);

  void deleteByTenantIdAndFlagKey(long tenantId, String flagKey);
}
