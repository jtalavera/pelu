package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.ProfessionalActivationToken;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

public interface ProfessionalActivationTokenRepository
    extends JpaRepository<ProfessionalActivationToken, Long> {

  Optional<ProfessionalActivationToken> findByTokenHashAndUsedFalse(String tokenHash);

  @Modifying
  @Query("UPDATE ProfessionalActivationToken t SET t.used = true WHERE t.professional.id = :professionalId AND t.used = false")
  void invalidateAllForProfessional(Long professionalId);
}
