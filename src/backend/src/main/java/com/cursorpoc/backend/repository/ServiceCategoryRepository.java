package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.ServiceCategory;
import com.cursorpoc.backend.domain.enums.ServiceKind;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ServiceCategoryRepository extends JpaRepository<ServiceCategory, Long> {

  List<ServiceCategory> findByTenant_IdOrderByNameAsc(Long tenantId);

  List<ServiceCategory> findByTenant_IdAndKindOrderByNameAsc(Long tenantId, ServiceKind kind);

  Optional<ServiceCategory> findByIdAndTenant_Id(Long id, Long tenantId);

  Optional<ServiceCategory> findByNameAndTenant_Id(String name, Long tenantId);

  long countByTenant_Id(Long tenantId);

  long deleteByTenant_Id(Long tenantId);
}
