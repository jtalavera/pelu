package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.SalonService;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface SalonServiceRepository extends JpaRepository<SalonService, Long> {

  @Query(
      """
      SELECT s FROM SalonService s
      JOIN FETCH s.category c
      LEFT JOIN FETCH s.tax t
      WHERE s.tenant.id = :tenantId
      ORDER BY s.name ASC
      """)
  List<SalonService> findByTenant_IdOrderByNameAsc(@Param("tenantId") Long tenantId);

  Optional<SalonService> findByIdAndTenant_Id(Long id, Long tenantId);

  long countByTenant_Id(Long tenantId);

  long deleteByTenant_Id(Long tenantId);
}
