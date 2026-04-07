package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.Tenant;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TenantRepository extends JpaRepository<Tenant, Long> {}
