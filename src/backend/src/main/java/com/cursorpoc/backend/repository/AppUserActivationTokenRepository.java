package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.AppUserActivationToken;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

public interface AppUserActivationTokenRepository
    extends JpaRepository<AppUserActivationToken, Long> {

  Optional<AppUserActivationToken> findByTokenHashAndUsedFalse(String tokenHash);

  /**
   * HU-43: distinguishes "never activated" (still {@code PENDING_ACTIVATION}) from "deactivated
   * after having activated" ({@code DISABLED}) for the tenant users listing — both states share the
   * same {@code AppUser#enabled == false}.
   */
  boolean existsByAppUser_IdAndUsedTrue(Long appUserId);

  /** HU-44: reinviting/resending must invalidate any previously issued link for this user. */
  @Modifying
  @Query(
      "UPDATE AppUserActivationToken t SET t.used = true WHERE t.appUser.id = :appUserId AND t.used = false")
  void invalidateAllForAppUser(Long appUserId);

  long deleteByAppUser_Tenant_Id(Long tenantId);
}
