package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.ServiceCategory;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ServiceCategoryRepository extends JpaRepository<ServiceCategory, Long> {

  List<ServiceCategory> findByTenant_IdOrderByNameAsc(Long tenantId);

  Optional<ServiceCategory> findByIdAndTenant_Id(Long id, Long tenantId);
}
