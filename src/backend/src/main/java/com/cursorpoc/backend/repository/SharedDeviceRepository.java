package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.SharedDevice;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SharedDeviceRepository extends JpaRepository<SharedDevice, Long> {

  Optional<SharedDevice> findByTokenHash(String tokenHash);

  Optional<SharedDevice> findByIdAndTenant_Id(Long id, Long tenantId);

  List<SharedDevice> findByTenant_IdAndRevokedAtIsNullOrderByCreatedAtDesc(Long tenantId);

  long deleteByTenant_Id(Long tenantId);
}
