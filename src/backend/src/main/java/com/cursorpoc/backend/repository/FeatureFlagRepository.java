package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.FeatureFlag;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface FeatureFlagRepository extends JpaRepository<FeatureFlag, Long> {

  Optional<FeatureFlag> findByFlagKey(String flagKey);

  List<FeatureFlag> findAllByOrderByFlagKeyAsc();
}
