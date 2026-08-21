package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.TenantImportRun;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TenantImportRunRepository extends JpaRepository<TenantImportRun, Long> {

  Optional<TenantImportRun> findByTenantIdAndEntityType(Long tenantId, String entityType);
}
