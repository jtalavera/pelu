package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.FemmeJwtProperties;
import com.cursorpoc.backend.domain.AppUser;
import com.cursorpoc.backend.domain.PasswordResetToken;
import com.cursorpoc.backend.repository.AppUserRepository;
import com.cursorpoc.backend.repository.PasswordResetTokenRepository;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.security.JwtService;
import com.cursorpoc.backend.web.dto.ForgotPasswordRequest;
import com.cursorpoc.backend.web.dto.LoginRequest;
import com.cursorpoc.backend.web.dto.ResetPasswordRequest;
import com.cursorpoc.backend.web.dto.TokenResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HexFormat;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class AuthService {

  private static final Logger log = LoggerFactory.getLogger(AuthService.class);

  private final AppUserRepository appUserRepository;
  private final PasswordResetTokenRepository passwordResetTokenRepository;
  private final PasswordEncoder passwordEncoder;
  private final JwtService jwtService;
  private final FemmeJwtProperties jwtProperties;

  public AuthService(
      AppUserRepository appUserRepository,
      PasswordResetTokenRepository passwordResetTokenRepository,
      PasswordEncoder passwordEncoder,
      JwtService jwtService,
      FemmeJwtProperties jwtProperties) {
    this.appUserRepository = appUserRepository;
    this.passwordResetTokenRepository = passwordResetTokenRepository;
    this.passwordEncoder = passwordEncoder;
    this.jwtService = jwtService;
    this.jwtProperties = jwtProperties;
  }

  public TokenResponse login(LoginRequest request) {
    AppUser user =
        appUserRepository
            .findByEmail(request.email().trim().toLowerCase())
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS"));
    if (!passwordEncoder.matches(request.password(), user.getPasswordHash())) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS");
    }
    Instant now = Instant.now();
    String token =
        jwtService.createAccessToken(user.getId(), user.getTenant().getId(), user.getEmail(), now);
    return new TokenResponse(token, jwtProperties.getAccessTokenTtlSeconds(), "Bearer");
  }

  public TokenResponse refresh(FemmeUserPrincipal principal) {
    Instant now = Instant.now();
    String token =
        jwtService.createAccessToken(
            principal.getUserId(), principal.getTenantId(), principal.getUsername(), now);
    return new TokenResponse(token, jwtProperties.getAccessTokenTtlSeconds(), "Bearer");
  }

  @Transactional
  public void forgotPassword(ForgotPasswordRequest request) {
    Optional<AppUser> userOpt = appUserRepository.findByEmail(request.email().trim().toLowerCase());
    if (userOpt.isEmpty()) {
      return;
    }
    AppUser user = userOpt.get();
    String raw = UUID.randomUUID().toString();
    String hash = sha256Hex(raw);
    PasswordResetToken entity = new PasswordResetToken();
    entity.setUser(user);
    entity.setTokenHash(hash);
    entity.setExpiresAt(Instant.now().plus(48, ChronoUnit.HOURS));
    entity.setUsed(false);
    passwordResetTokenRepository.save(entity);
    log.info("password reset link (dev): http://localhost:5173/reset-password?token={}", raw);
  }

  @Transactional
  public void resetPassword(ResetPasswordRequest request) {
    String hash = sha256Hex(request.token());
    PasswordResetToken token =
        passwordResetTokenRepository
            .findByTokenHashAndUsedFalse(hash)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_TOKEN"));
    if (token.getExpiresAt().isBefore(Instant.now())) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "TOKEN_EXPIRED");
    }
    AppUser user = token.getUser();
    user.setPasswordHash(passwordEncoder.encode(request.newPassword()));
    token.setUsed(true);
    appUserRepository.save(user);
    passwordResetTokenRepository.save(token);
  }

  private static String sha256Hex(String raw) {
    try {
      MessageDigest md = MessageDigest.getInstance("SHA-256");
      byte[] digest = md.digest(raw.getBytes(StandardCharsets.UTF_8));
      return HexFormat.of().formatHex(digest);
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }
}
