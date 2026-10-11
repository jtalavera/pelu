package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.SalonService;
import com.cursorpoc.backend.domain.enums.ServiceKind;
import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
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

  /** Issue #217: active services only, for the shareable price-list PDF. */
  List<SalonService> findByTenant_IdAndActiveTrueOrderByNameAsc(Long tenantId);

  @Query(
      value =
          """
          SELECT s FROM SalonService s
          JOIN FETCH s.category c
          LEFT JOIN FETCH s.tax t
          WHERE s.tenant.id = :tenantId
          AND (:categoryId IS NULL OR c.id = :categoryId)
          AND (:active IS NULL OR s.active = :active)
          AND (:kind IS NULL OR s.kind = :kind)
          AND (:q IS NULL
               OR LOWER(s.name) LIKE LOWER(CONCAT('%', :q, '%'))
               OR LOWER(c.name) LIKE LOWER(CONCAT('%', :q, '%')))
          ORDER BY s.active DESC, c.name ASC, s.name ASC
          """,
      countQuery =
          """
          SELECT COUNT(s) FROM SalonService s
          JOIN s.category c
          WHERE s.tenant.id = :tenantId
          AND (:categoryId IS NULL OR c.id = :categoryId)
          AND (:active IS NULL OR s.active = :active)
          AND (:kind IS NULL OR s.kind = :kind)
          AND (:q IS NULL
               OR LOWER(s.name) LIKE LOWER(CONCAT('%', :q, '%'))
               OR LOWER(c.name) LIKE LOWER(CONCAT('%', :q, '%')))
          """)
  Page<SalonService> findByTenantFilteredPaged(
      @Param("tenantId") Long tenantId,
      @Param("categoryId") Long categoryId,
      @Param("active") Boolean active,
      @Param("kind") ServiceKind kind,
      @Param("q") String q,
      Pageable pageable);

  /** HU-62: every PRODUCT of a tenant (active or not) for a full catalog sync to control-stock. */
  @Query(
      """
      SELECT s FROM SalonService s
      JOIN FETCH s.category c
      WHERE s.tenant.id = :tenantId
      AND s.kind = com.cursorpoc.backend.domain.enums.ServiceKind.PRODUCT
      ORDER BY s.id ASC
      """)
  List<SalonService> findProductsByTenantId(@Param("tenantId") Long tenantId);

  @Query(
      """
      SELECT s FROM SalonService s
      JOIN FETCH s.category c
      WHERE s.tenant.id = :tenantId AND s.id IN :ids
      """)
  List<SalonService> findByTenantIdAndIdIn(
      @Param("tenantId") Long tenantId, @Param("ids") java.util.Collection<Long> ids);

  Optional<SalonService> findByIdAndTenant_Id(Long id, Long tenantId);

  boolean existsByNameAndCategory_IdAndTenant_Id(String name, Long categoryId, Long tenantId);

  long countByTenant_Id(Long tenantId);

  long deleteByTenant_Id(Long tenantId);
}
