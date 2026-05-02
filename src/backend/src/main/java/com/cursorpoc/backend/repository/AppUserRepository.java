package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.AppUser;
import java.util.Optional;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AppUserRepository extends JpaRepository<AppUser, Long> {

  @EntityGraph(attributePaths = "tenant")
  Optional<AppUser> findByEmailAndTenant_Id(String email, Long tenantId);

  @EntityGraph(attributePaths = "tenant")
  Optional<AppUser> findByEmail(String email);

  long countByTenant_Id(Long tenantId);
}
