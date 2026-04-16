package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.Professional;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ProfessionalRepository extends JpaRepository<Professional, Long> {

  List<Professional> findByTenant_IdOrderByFullNameAsc(Long tenantId);

  Optional<Professional> findByIdAndTenant_Id(Long id, Long tenantId);

  Optional<Professional> findByUser_Id(Long userId);

  boolean existsByTenant_IdAndPinFingerprintAndIdNot(Long tenantId, String pinFingerprint, Long excludeId);

  boolean existsByTenant_IdAndPinFingerprint(Long tenantId, String pinFingerprint);
}
