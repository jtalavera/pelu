package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.TenantSifenHomologationStatus;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TenantSifenHomologationStatusRepository
    extends JpaRepository<TenantSifenHomologationStatus, Long> {

  Optional<TenantSifenHomologationStatus> findByTenantId(long tenantId);
}
