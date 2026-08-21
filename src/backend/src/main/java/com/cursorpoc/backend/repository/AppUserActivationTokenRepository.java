package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.AppUserActivationToken;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

public interface AppUserActivationTokenRepository
    extends JpaRepository<AppUserActivationToken, Long> {

  Optional<AppUserActivationToken> findByTokenHashAndUsedFalse(String tokenHash);

  /** HU-44: reinviting/resending must invalidate any previously issued link for this user. */
  @Modifying
  @Query(
      "UPDATE AppUserActivationToken t SET t.used = true WHERE t.appUser.id = :appUserId AND t.used = false")
  void invalidateAllForAppUser(Long appUserId);

  long deleteByAppUser_Tenant_Id(Long tenantId);
}
