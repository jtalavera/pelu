package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.Client;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ClientRepository extends JpaRepository<Client, Long> {

  Optional<Client> findByIdAndTenant_Id(Long id, Long tenantId);

  @Query(
      """
      SELECT c FROM Client c WHERE c.tenant.id = :tenantId AND c.active = true
      AND (
        LOWER(c.fullName) LIKE LOWER(CONCAT('%', :q, '%'))
        OR (:phone IS NOT NULL AND c.phone IS NOT NULL AND c.phone LIKE CONCAT('%', :phone, '%'))
        OR (:ruc IS NOT NULL AND c.ruc IS NOT NULL AND c.ruc LIKE CONCAT('%', :ruc, '%'))
      )
      ORDER BY c.fullName ASC
      """)
  List<Client> search(
      @Param("tenantId") Long tenantId,
      @Param("q") String q,
      @Param("phone") String phone,
      @Param("ruc") String ruc);

  @Query(
      "SELECT c FROM Client c WHERE c.tenant.id = :tenantId AND c.phone = :phone AND c.phone IS NOT NULL")
  Optional<Client> findByTenantIdAndPhone(
      @Param("tenantId") Long tenantId, @Param("phone") String phone);

  @Query(
      "SELECT c FROM Client c WHERE c.tenant.id = :tenantId AND LOWER(c.email) = LOWER(:email) AND c.email IS NOT NULL")
  Optional<Client> findByTenantIdAndEmail(
      @Param("tenantId") Long tenantId, @Param("email") String email);

  @Query(
      "SELECT c FROM Client c WHERE c.tenant.id = :tenantId AND c.ruc = :ruc AND c.ruc IS NOT NULL")
  Optional<Client> findByTenantIdAndRuc(@Param("tenantId") Long tenantId, @Param("ruc") String ruc);
}
