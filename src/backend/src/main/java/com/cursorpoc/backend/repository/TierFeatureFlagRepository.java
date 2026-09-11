package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.TierFeatureFlag;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TierFeatureFlagRepository extends JpaRepository<TierFeatureFlag, Long> {

  Optional<TierFeatureFlag> findByTierIdAndFlagKey(long tierId, String flagKey);

  List<TierFeatureFlag> findAllByTierIdOrderByFlagKeyAsc(long tierId);

  void deleteByTierIdAndFlagKey(long tierId, String flagKey);
}
