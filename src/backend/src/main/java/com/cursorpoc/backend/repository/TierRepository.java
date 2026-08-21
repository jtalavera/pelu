package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.Tier;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TierRepository extends JpaRepository<Tier, Long> {

  Optional<Tier> findByNameIgnoreCase(String name);

  List<Tier> findAllByOrderByNameAsc();
}
