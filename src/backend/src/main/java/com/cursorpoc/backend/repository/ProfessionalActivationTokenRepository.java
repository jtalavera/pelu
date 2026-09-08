package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.ProfessionalActivationToken;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

public interface ProfessionalActivationTokenRepository
    extends JpaRepository<ProfessionalActivationToken, Long> {

  Optional<ProfessionalActivationToken> findByTokenHashAndUsedFalse(String tokenHash);

  /**
   * HU-43: same "never activated" vs "deactivated after having activated" distinction as {@link
   * com.cursorpoc.backend.repository.AppUserActivationTokenRepository#existsByAppUser_IdAndUsedTrue},
   * for professionals granted login access via {@code AuthService#grantProfessionalAccess}.
   */
  boolean existsByProfessional_User_IdAndUsedTrue(Long userId);

  @Modifying
  @Query(
      "UPDATE ProfessionalActivationToken t SET t.used = true WHERE t.professional.id = :professionalId AND t.used = false")
  void invalidateAllForProfessional(Long professionalId);

  long deleteByProfessional_Tenant_Id(Long tenantId);
}
