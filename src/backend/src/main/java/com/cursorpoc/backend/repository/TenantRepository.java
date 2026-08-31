package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.Tenant;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface TenantRepository extends JpaRepository<Tenant, Long> {

  Optional<Tenant> findByDomain(String domain);

  // HU-38 AC-2: domain uniqueness check on edit, excluding the tenant being edited.
  Optional<Tenant> findByDomainAndIdNot(String domain, Long id);

  // HU-45 AC-3/AC-4: how many tenants currently have this tier assigned — drives both the
  // listing's per-tier count and the delete-in-use protection.
  long countByTierId(Long tierId);

  // HU-39 AC-2: search matches name or domain (case-insensitive, partial). A blank/null q leaves
  // every tenant in scope — same "empty filter" convention as
  // ClientRepository#findByTenantFilteredPaged.
  @Query(
      """
      SELECT t FROM Tenant t WHERE
      (:q IS NULL
           OR LOWER(t.name) LIKE LOWER(CONCAT('%', :q, '%'))
           OR (t.domain IS NOT NULL AND LOWER(t.domain) LIKE LOWER(CONCAT('%', :q, '%'))))
      """)
  Page<Tenant> findFiltered(@Param("q") String q, Pageable pageable);
}
