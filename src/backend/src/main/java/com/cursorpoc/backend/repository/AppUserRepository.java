package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.AppUser;
import com.cursorpoc.backend.domain.enums.UserRole;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AppUserRepository extends JpaRepository<AppUser, Long> {

  @EntityGraph(attributePaths = "tenant")
  Optional<AppUser> findByEmailAndTenant_Id(String email, Long tenantId);

  // HU-57: lets the platform-admin bootstrap check "does at least one PLATFORM_ADMIN already
  // exist" without loading any rows, for idempotency (AC-3).
  boolean existsByRole(UserRole role);

  @EntityGraph(attributePaths = "tenant")
  Optional<AppUser> findByEmail(String email);

  // Login tenant resolution: email is only unique per (tenant_id, email), not globally — the
  // same email can exist across multiple tenants (or as a tenant-less PLATFORM_ADMIN). Callers
  // decide what to do with more than one row; unlike findByEmail() above, this never throws for
  // a non-unique email.
  @EntityGraph(attributePaths = "tenant")
  List<AppUser> findAllByEmail(String email);

  Optional<AppUser> findFirstByTenant_IdOrderByIdAsc(Long tenantId);

  long countByTenant_Id(Long tenantId);

  long deleteByTenant_Id(Long tenantId);

  // HU-42 AC-3: lists every AppUser (ADMIN and PROFESSIONAL-with-access) belonging to a tenant,
  // so the Platform Admin can see all admins assigned to it (no artificial one-admin-per-tenant
  // limit, AC-1) alongside the professionals who have login access.
  List<AppUser> findByTenant_IdOrderByRoleAscEmailAsc(Long tenantId);
}
