package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.FemmeJwtProperties;
import com.cursorpoc.backend.domain.AppUser;
import com.cursorpoc.backend.domain.PasswordResetToken;
import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.ProfessionalActivationToken;
import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.repository.AppUserRepository;
import com.cursorpoc.backend.repository.PasswordResetTokenRepository;
import com.cursorpoc.backend.repository.ProfessionalActivationTokenRepository;
import com.cursorpoc.backend.repository.ProfessionalRepository;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.security.JwtService;
import com.cursorpoc.backend.web.dto.ActivateProfessionalRequest;
import com.cursorpoc.backend.web.dto.ActivationTokenInfoResponse;
import com.cursorpoc.backend.web.dto.ForgotPasswordRequest;
import com.cursorpoc.backend.web.dto.GrantAccessResponse;
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
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class AuthService {

  private static final Logger log = LoggerFactory.getLogger(AuthService.class);

  private static final Pattern PASSWORD_UPPER = Pattern.compile(".*[A-Z].*");
  private static final Pattern PASSWORD_LOWER = Pattern.compile(".*[a-z].*");
  private static final Pattern PASSWORD_DIGIT = Pattern.compile(".*[0-9].*");
  private static final Pattern PASSWORD_SPECIAL = Pattern.compile(".*[!@#$%^&*()_+\\-=\\[\\]{};':\"\\\\|,.<>/?].*");

  @Value("${app.frontend.url:http://localhost:5173}")
  private String frontendUrl;

  private final AppUserRepository appUserRepository;
  private final PasswordResetTokenRepository passwordResetTokenRepository;
  private final ProfessionalActivationTokenRepository activationTokenRepository;
  private final ProfessionalRepository professionalRepository;
  private final PasswordEncoder passwordEncoder;
  private final JwtService jwtService;
  private final FemmeJwtProperties jwtProperties;
  private final EmailService emailService;

  public AuthService(
      AppUserRepository appUserRepository,
      PasswordResetTokenRepository passwordResetTokenRepository,
      ProfessionalActivationTokenRepository activationTokenRepository,
      ProfessionalRepository professionalRepository,
      PasswordEncoder passwordEncoder,
      JwtService jwtService,
      FemmeJwtProperties jwtProperties,
      EmailService emailService) {
    this.appUserRepository = appUserRepository;
    this.passwordResetTokenRepository = passwordResetTokenRepository;
    this.activationTokenRepository = activationTokenRepository;
    this.professionalRepository = professionalRepository;
    this.passwordEncoder = passwordEncoder;
    this.jwtService = jwtService;
    this.jwtProperties = jwtProperties;
    this.emailService = emailService;
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
    if (!user.isEnabled()) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS");
    }
    Long professionalId = null;
    if (user.getRole() == UserRole.PROFESSIONAL) {
      professionalId = professionalRepository
          .findByUser_Id(user.getId())
          .map(Professional::getId)
          .orElse(null);
    }
    Instant now = Instant.now();
    String token = jwtService.createAccessToken(
        user.getId(), user.getTenant().getId(), user.getEmail(), user.getRole(), professionalId, now);
    return new TokenResponse(token, jwtProperties.getAccessTokenTtlSeconds(), "Bearer");
  }

  public TokenResponse refresh(FemmeUserPrincipal principal) {
    Instant now = Instant.now();
    String token = jwtService.createAccessToken(
        principal.getUserId(), principal.getTenantId(), principal.getUsername(),
        principal.getRole(), principal.getProfessionalId(), now);
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

  @Transactional
  public GrantAccessResponse grantProfessionalAccess(long tenantId, long professionalId) {
    Professional professional = professionalRepository
        .findByIdAndTenant_Id(professionalId, tenantId)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "PROFESSIONAL_NOT_FOUND"));

    if (professional.getEmail() == null || professional.getEmail().isBlank()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "PROFESSIONAL_EMAIL_REQUIRED_FOR_ACCESS");
    }

    String email = professional.getEmail().trim().toLowerCase();

    // Invalidate any existing activation tokens for this professional
    activationTokenRepository.invalidateAllForProfessional(professionalId);

    String raw = UUID.randomUUID().toString();
    String hash = sha256Hex(raw);
    ProfessionalActivationToken token = new ProfessionalActivationToken();
    token.setProfessional(professional);
    token.setTokenHash(hash);
    token.setExpiresAt(Instant.now().plus(48, ChronoUnit.HOURS));
    token.setUsed(false);
    activationTokenRepository.save(token);

    professional.setSystemAccessAllowed(true);
    professionalRepository.save(professional);

    String activationUrl = frontendUrl + "/activate?token=" + raw;
    emailService.sendActivationLink(email, activationUrl);

    return new GrantAccessResponse(true, raw);
  }

  @Transactional
  public void revokeProfessionalAccess(long tenantId, long professionalId) {
    Professional professional = professionalRepository
        .findByIdAndTenant_Id(professionalId, tenantId)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "PROFESSIONAL_NOT_FOUND"));

    professional.setSystemAccessAllowed(false);
    if (professional.getUser() != null) {
      professional.getUser().setEnabled(false);
      appUserRepository.save(professional.getUser());
    }
    activationTokenRepository.invalidateAllForProfessional(professionalId);
    professionalRepository.save(professional);
  }

  @Transactional(readOnly = true)
  public ActivationTokenInfoResponse validateActivationToken(String rawToken) {
    String hash = sha256Hex(rawToken);
    ProfessionalActivationToken token = activationTokenRepository
        .findByTokenHashAndUsedFalse(hash)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_TOKEN"));
    if (token.getExpiresAt().isBefore(Instant.now())) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "TOKEN_EXPIRED");
    }
    Professional prof = token.getProfessional();
    return new ActivationTokenInfoResponse(prof.getId(), prof.getFullName(), prof.getEmail());
  }

  @Transactional
  public void activateProfessionalAccount(ActivateProfessionalRequest request) {
    validatePasswordStrength(request.password());
    if (!request.password().equals(request.confirmPassword())) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "PASSWORDS_DO_NOT_MATCH");
    }

    String hash = sha256Hex(request.token());
    ProfessionalActivationToken activationToken = activationTokenRepository
        .findByTokenHashAndUsedFalse(hash)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_TOKEN"));
    if (activationToken.getExpiresAt().isBefore(Instant.now())) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "TOKEN_EXPIRED");
    }

    Professional professional = activationToken.getProfessional();
    String email = professional.getEmail().trim().toLowerCase();

    AppUser user;
    Optional<AppUser> existing = appUserRepository.findByEmail(email);
    if (existing.isPresent()) {
      user = existing.get();
      user.setEnabled(true);
    } else {
      user = new AppUser();
      user.setTenant(professional.getTenant());
      user.setEmail(email);
      user.setRole(UserRole.PROFESSIONAL);
      user.setEnabled(true);
    }
    user.setPasswordHash(passwordEncoder.encode(request.password()));
    appUserRepository.save(user);

    professional.setUser(user);
    professional.setSystemAccessAllowed(true);
    professionalRepository.save(professional);

    activationToken.setUsed(true);
    activationTokenRepository.save(activationToken);
  }

  private static void validatePasswordStrength(String password) {
    if (password == null || password.length() < 8) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "PASSWORD_TOO_WEAK");
    }
    if (!PASSWORD_UPPER.matcher(password).matches()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "PASSWORD_TOO_WEAK");
    }
    if (!PASSWORD_LOWER.matcher(password).matches()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "PASSWORD_TOO_WEAK");
    }
    if (!PASSWORD_DIGIT.matcher(password).matches()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "PASSWORD_TOO_WEAK");
    }
    if (!PASSWORD_SPECIAL.matcher(password).matches()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "PASSWORD_TOO_WEAK");
    }
  }

  static String sha256Hex(String raw) {
    try {
      MessageDigest md = MessageDigest.getInstance("SHA-256");
      byte[] digest = md.digest(raw.getBytes(StandardCharsets.UTF_8));
      return HexFormat.of().formatHex(digest);
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }
}
