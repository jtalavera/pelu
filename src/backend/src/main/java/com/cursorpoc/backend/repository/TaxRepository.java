package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.Tax;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TaxRepository extends JpaRepository<Tax, Long> {

  List<Tax> findByTenant_IdOrderByNameAsc(Long tenantId);

  List<Tax> findByTenant_IdAndActiveOrderByNameAsc(Long tenantId, boolean active);

  Optional<Tax> findByIdAndTenant_Id(Long id, Long tenantId);

  long deleteByTenant_Id(Long tenantId);
}
