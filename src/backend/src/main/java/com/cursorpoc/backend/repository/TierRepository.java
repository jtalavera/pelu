package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.Tier;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TierRepository extends JpaRepository<Tier, Long> {

  Optional<Tier> findByNameIgnoreCase(String name);

  List<Tier> findAllByOrderByNameAsc();

  // HU-45 AC-5: name uniqueness check on create.
  boolean existsByNameIgnoreCase(String name);

  // HU-45 AC-5: name uniqueness check on edit, excluding the tier being edited.
  boolean existsByNameIgnoreCaseAndIdNot(String name, Long id);
}
