package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.ProfessionalPinLock;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ProfessionalPinLockRepository extends JpaRepository<ProfessionalPinLock, Long> {

  Optional<ProfessionalPinLock> findByDevice_IdAndProfessional_Id(
      Long deviceId, Long professionalId);

  List<ProfessionalPinLock> findByDevice_Id(Long deviceId);

  List<ProfessionalPinLock> findByProfessional_Id(Long professionalId);

  long deleteByProfessional_Tenant_Id(Long tenantId);
}
