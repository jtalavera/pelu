package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.TenantStatusChange;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TenantStatusChangeRepository extends JpaRepository<TenantStatusChange, Long> {

  Optional<TenantStatusChange> findByTenantId(Long tenantId);
}
