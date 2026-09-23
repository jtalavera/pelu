package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.TierFeatureFlagChange;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TierFeatureFlagChangeRepository
    extends JpaRepository<TierFeatureFlagChange, Long> {

  Optional<TierFeatureFlagChange> findByTierIdAndFlagKey(long tierId, String flagKey);
}
