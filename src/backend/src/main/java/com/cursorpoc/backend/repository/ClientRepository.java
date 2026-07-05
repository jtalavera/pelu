package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.Client;
import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ClientRepository extends JpaRepository<Client, Long> {

  Optional<Client> findByIdAndTenant_Id(Long id, Long tenantId);

  List<Client> findByTenant_Id(Long tenantId);

  @Query(
      """
      SELECT c FROM Client c WHERE c.tenant.id = :tenantId
      AND (:q IS NULL
           OR LOWER(c.fullName) LIKE LOWER(CONCAT('%', :q, '%'))
           OR (c.phone IS NOT NULL AND c.phone LIKE CONCAT('%', :q, '%'))
           OR (c.email IS NOT NULL AND LOWER(c.email) LIKE LOWER(CONCAT('%', :q, '%')))
           OR (c.ruc IS NOT NULL AND c.ruc LIKE CONCAT('%', :q, '%')))
      AND (:active IS NULL OR c.active = :active)
      AND (:withRuc IS NULL OR c.ruc IS NOT NULL)
      AND (:isNew IS NULL OR c.visitCount = 0)
      ORDER BY c.fullName ASC
      """)
  Page<Client> findByTenantFilteredPaged(
      @Param("tenantId") Long tenantId,
      @Param("q") String q,
      @Param("active") Boolean active,
      @Param("withRuc") Boolean withRuc,
      @Param("isNew") Boolean isNew,
      Pageable pageable);

  @Query(
      "SELECT c FROM Client c WHERE c.tenant.id = :tenantId AND LOWER(c.email) = LOWER(:email) AND c.email IS NOT NULL")
  Optional<Client> findByTenantIdAndEmail(
      @Param("tenantId") Long tenantId, @Param("email") String email);

  @Query(
      "SELECT c FROM Client c WHERE c.tenant.id = :tenantId AND c.ruc = :ruc AND c.ruc IS NOT NULL")
  Optional<Client> findByTenantIdAndRuc(@Param("tenantId") Long tenantId, @Param("ruc") String ruc);

  long deleteByTenant_Id(Long tenantId);
}
