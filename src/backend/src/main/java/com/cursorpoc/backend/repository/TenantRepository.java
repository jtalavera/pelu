package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.Tenant;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TenantRepository extends JpaRepository<Tenant, Long> {

  Optional<Tenant> findByDomain(String domain);

  // HU-38 AC-2: domain uniqueness check on edit, excluding the tenant being edited.
  Optional<Tenant> findByDomainAndIdNot(String domain, Long id);

  Optional<Tenant> findFirstByOrderByIdAsc();
}
