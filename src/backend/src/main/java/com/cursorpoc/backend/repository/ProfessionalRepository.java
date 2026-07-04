package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.Professional;
import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ProfessionalRepository extends JpaRepository<Professional, Long> {

  List<Professional> findByTenant_IdOrderByFullNameAsc(Long tenantId);

  @Query(
      """
      SELECT p FROM Professional p
      WHERE p.tenant.id = :tenantId
      AND (:q IS NULL
           OR LOWER(p.fullName) LIKE LOWER(CONCAT('%', :q, '%'))
           OR (p.phone IS NOT NULL AND LOWER(p.phone) LIKE LOWER(CONCAT('%', :q, '%')))
           OR (p.email IS NOT NULL AND LOWER(p.email) LIKE LOWER(CONCAT('%', :q, '%'))))
      ORDER BY p.fullName ASC
      """)
  Page<Professional> findByTenantFilteredPaged(
      @Param("tenantId") Long tenantId, @Param("q") String q, Pageable pageable);

  Optional<Professional> findByIdAndTenant_Id(Long id, Long tenantId);

  Optional<Professional> findByUser_Id(Long userId);

  boolean existsByTenant_IdAndPinFingerprintAndIdNot(
      Long tenantId, String pinFingerprint, Long excludeId);

  boolean existsByTenant_IdAndPinFingerprint(Long tenantId, String pinFingerprint);

  boolean existsByTenant_IdAndEmailIgnoreCaseAndIdNot(Long tenantId, String email, Long excludeId);

  boolean existsByTenant_IdAndEmailIgnoreCase(Long tenantId, String email);

  long countByTenant_Id(Long tenantId);

  long deleteByTenant_Id(Long tenantId);
}
