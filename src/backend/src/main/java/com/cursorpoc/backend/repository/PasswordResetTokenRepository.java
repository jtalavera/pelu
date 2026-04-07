package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.PasswordResetToken;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PasswordResetTokenRepository extends JpaRepository<PasswordResetToken, Long> {

  Optional<PasswordResetToken> findByTokenHashAndUsedFalse(String tokenHash);
}
