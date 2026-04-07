package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.BusinessProfile;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface BusinessProfileRepository extends JpaRepository<BusinessProfile, Long> {

  Optional<BusinessProfile> findByTenantId(Long tenantId);
}
