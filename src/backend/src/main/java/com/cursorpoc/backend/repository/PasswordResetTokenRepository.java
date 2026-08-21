package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.PasswordResetToken;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

public interface PasswordResetTokenRepository extends JpaRepository<PasswordResetToken, Long> {

  Optional<PasswordResetToken> findByTokenHashAndUsedFalse(String tokenHash);

  long deleteByUser_Tenant_Id(Long tenantId);

  /**
   * HU-44 AC-3: triggering a new password reset (self-service or Platform-Admin-initiated) must
   * invalidate any previously issued, still-unused link for this user.
   */
  @Modifying
  @Query(
      "UPDATE PasswordResetToken t SET t.used = true WHERE t.user.id = :userId AND t.used = false")
  void invalidateAllForUser(Long userId);
}
