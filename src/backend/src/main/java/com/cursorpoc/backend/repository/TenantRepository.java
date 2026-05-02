package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.Tenant;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TenantRepository extends JpaRepository<Tenant, Long> {

  Optional<Tenant> findByDomain(String domain);

  Optional<Tenant> findFirstByOrderByIdAsc();
}
