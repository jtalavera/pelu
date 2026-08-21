package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.FemmeJwtProperties;
import com.cursorpoc.backend.domain.AppUser;
import com.cursorpoc.backend.domain.AppUserActivationToken;
import com.cursorpoc.backend.domain.PasswordResetToken;
import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.ProfessionalActivationToken;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.TenantStatus;
import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.repository.AppUserActivationTokenRepository;
import com.cursorpoc.backend.repository.AppUserRepository;
import com.cursorpoc.backend.repository.PasswordResetTokenRepository;
import com.cursorpoc.backend.repository.ProfessionalActivationTokenRepository;
import com.cursorpoc.backend.repository.ProfessionalRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.security.JwtService;
import com.cursorpoc.backend.web.dto.ActivateProfessionalRequest;
import com.cursorpoc.backend.web.dto.ActivationTokenInfoResponse;
import com.cursorpoc.backend.web.dto.ForgotPasswordRequest;
import com.cursorpoc.backend.web.dto.GrantAccessResponse;
import com.cursorpoc.backend.web.dto.LoginRequest;
import com.cursorpoc.backend.web.dto.ResetPasswordRequest;
import com.cursorpoc.backend.web.dto.TokenResponse;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HexFormat;
import java.util.Locale;
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
  private static final Pattern PASSWORD_SPECIAL =
      Pattern.compile(".*[!@#$%^&*()_+\\-=\\[\\]{};':\"\\\\|,.<>/?].*");

  @Value("${app.frontend.url}")
  private String frontendUrl;

  private final AppUserRepository appUserRepository;
  private final PasswordResetTokenRepository passwordResetTokenRepository;
  private final ProfessionalActivationTokenRepository activationTokenRepository;
  private final AppUserActivationTokenRepository appUserActivationTokenRepository;
  private final ProfessionalRepository professionalRepository;
  private final TenantRepository tenantRepository;
  private final PasswordEncoder passwordEncoder;
  private final JwtService jwtService;
  private final FemmeJwtProperties jwtProperties;
  private final EmailService emailService;

  public AuthService(
      AppUserRepository appUserRepository,
      PasswordResetTokenRepository passwordResetTokenRepository,
      ProfessionalActivationTokenRepository activationTokenRepository,
      AppUserActivationTokenRepository appUserActivationTokenRepository,
      ProfessionalRepository professionalRepository,
      TenantRepository tenantRepository,
      PasswordEncoder passwordEncoder,
      JwtService jwtService,
      FemmeJwtProperties jwtProperties,
      EmailService emailService) {
    this.appUserRepository = appUserRepository;
    this.passwordResetTokenRepository = passwordResetTokenRepository;
    this.activationTokenRepository = activationTokenRepository;
    this.appUserActivationTokenRepository = appUserActivationTokenRepository;
    this.professionalRepository = professionalRepository;
    this.tenantRepository = tenantRepository;
    this.passwordEncoder = passwordEncoder;
    this.jwtService = jwtService;
    this.jwtProperties = jwtProperties;
    this.emailService = emailService;
  }

  public TokenResponse login(LoginRequest request, String origin) {
    String email = request.email().trim().toLowerCase();

    // HU-34: PLATFORM_ADMIN is tenant-independent — try a tenant-less lookup by email before
    // falling back to the tenant-scoped path below. findByEmail() is only reached here for emails
    // that actually belong to a PLATFORM_ADMIN row (tenant-bound emails still resolve exclusively
    // through resolveTenant()+findByEmailAndTenant_Id(), unchanged from before this story).
    Optional<AppUser> platformCandidate =
        appUserRepository.findByEmail(email).filter(u -> u.getRole() == UserRole.PLATFORM_ADMIN);
    if (platformCandidate.isPresent()) {
      AppUser platformUser = platformCandidate.get();
      if (!passwordEncoder.matches(request.password(), platformUser.getPasswordHash())) {
        throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS");
      }
      if (!platformUser.isEnabled()) {
        throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS");
      }
      Instant now = Instant.now();
      String token =
          jwtService.createAccessToken(
              platformUser.getId(),
              null,
              platformUser.getEmail(),
              platformUser.getRole(),
              null,
              now);
      return new TokenResponse(token, jwtProperties.getAccessTokenTtlSeconds(), "Bearer");
    }

    Tenant tenant = resolveTenant(origin);
    // HU-40 AC-2: a suspended tenant blocks login for every one of its users (admin or
    // professional). Checked before even looking up the user/password so the response is
    // byte-for-byte identical to "bad credentials" (same status, same error code) — an
    // enumeration attempt can't tell a suspended tenant apart from a wrong email/password.
    if (tenant.getStatus() == TenantStatus.SUSPENDED) {
      log.warn(
          "login rejected: tenant suspended tenantId={} (generic INVALID_CREDENTIALS returned)",
          tenant.getId());
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS");
    }
    AppUser user =
        appUserRepository
            .findByEmailAndTenant_Id(email, tenant.getId())
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
      professionalId =
          professionalRepository.findByUser_Id(user.getId()).map(Professional::getId).orElse(null);
    }
    Instant now = Instant.now();
    String token =
        jwtService.createAccessToken(
            user.getId(),
            user.getTenant().getId(),
            user.getEmail(),
            user.getRole(),
            professionalId,
            now);
    return new TokenResponse(token, jwtProperties.getAccessTokenTtlSeconds(), "Bearer");
  }

  public TokenResponse refresh(FemmeUserPrincipal principal) {
    Instant now = Instant.now();
    String token =
        jwtService.createAccessToken(
            principal.getUserId(),
            // HU-34: PLATFORM_ADMIN has no tenant — getTenantId() would throw; refresh must
            // preserve whatever tenant state (present or absent) the original token had.
            principal.getTenantIdOrNull(),
            principal.getUsername(),
            principal.getRole(),
            principal.getProfessionalId(),
            now);
    return new TokenResponse(token, jwtProperties.getAccessTokenTtlSeconds(), "Bearer");
  }

  @Transactional
  public void forgotPassword(ForgotPasswordRequest request, String origin, Locale locale) {
    Tenant tenant = resolveTenant(origin);
    Optional<AppUser> userOpt =
        appUserRepository.findByEmailAndTenant_Id(
            request.email().trim().toLowerCase(), tenant.getId());
    if (userOpt.isEmpty()) {
      // Deliberately silent — same "no enumeration" behavior whether or not the email exists.
      return;
    }
    issuePasswordResetToken(userOpt.get(), locale);
  }

  /**
   * HU-44 AC-2/AC-3/AC-4: Platform-Admin-triggered equivalent of {@link #forgotPassword} for a
   * tenant user who already activated their account but lost access. The caller already knows the
   * exact {@link AppUser} (no Origin/domain resolution — the Platform Admin isn't on the tenant's
   * own frontend), and the raw token is returned so Playwright e2e coverage can exercise the full
   * reset flow without reading the (dev-logged in e2e) email.
   */
  @Transactional
  public String triggerPasswordResetForUser(AppUser user, Locale locale) {
    return issuePasswordResetToken(user, locale);
  }

  /**
   * HU-44 AC-3: invalidates any previously issued, still-unused reset link for this user before
   * issuing and emailing a new one — shared by the self-service and Platform-Admin-triggered entry
   * points above.
   */
  private String issuePasswordResetToken(AppUser user, Locale locale) {
    passwordResetTokenRepository.invalidateAllForUser(user.getId());

    String raw = UUID.randomUUID().toString();
    PasswordResetToken entity = new PasswordResetToken();
    entity.setUser(user);
    entity.setTokenHash(sha256Hex(raw));
    entity.setExpiresAt(Instant.now().plus(48, ChronoUnit.HOURS));
    entity.setUsed(false);
    passwordResetTokenRepository.save(entity);

    String resetUrl = frontendUrl + "/reset-password?token=" + raw;
    emailService.sendPasswordResetLink(user.getEmail(), resetUrl, locale);
    return raw;
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
  public GrantAccessResponse grantProfessionalAccess(
      long tenantId, long professionalId, Locale locale) {
    Professional professional =
        professionalRepository
            .findByIdAndTenant_Id(professionalId, tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "PROFESSIONAL_NOT_FOUND"));

    if (professional.getEmail() == null || professional.getEmail().isBlank()) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "PROFESSIONAL_EMAIL_REQUIRED_FOR_ACCESS");
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
    emailService.sendActivationLink(email, activationUrl, locale);

    return new GrantAccessResponse(true, raw);
  }

  @Transactional
  public void revokeProfessionalAccess(long tenantId, long professionalId) {
    Professional professional =
        professionalRepository
            .findByIdAndTenant_Id(professionalId, tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "PROFESSIONAL_NOT_FOUND"));

    professional.setSystemAccessAllowed(false);
    if (professional.getUser() != null) {
      professional.getUser().setEnabled(false);
      appUserRepository.save(professional.getUser());
    }
    activationTokenRepository.invalidateAllForProfessional(professionalId);
    professionalRepository.save(professional);
  }

  /**
   * HU-41: {@code ActivatePage} is shared by both flows (AC-4), so this transparently checks the
   * professional-scoped token table first, then the app-user-scoped one (Platform-Admin-invited
   * tenant {@code ADMIN} users) — the frontend never needs to know which kind of token it has.
   */
  @Transactional(readOnly = true)
  public ActivationTokenInfoResponse validateActivationToken(String rawToken) {
    String hash = sha256Hex(rawToken);
    Optional<ProfessionalActivationToken> professionalToken =
        activationTokenRepository.findByTokenHashAndUsedFalse(hash);
    if (professionalToken.isPresent()) {
      ProfessionalActivationToken token = professionalToken.get();
      if (token.getExpiresAt().isBefore(Instant.now())) {
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "TOKEN_EXPIRED");
      }
      Professional prof = token.getProfessional();
      return new ActivationTokenInfoResponse(prof.getId(), prof.getFullName(), prof.getEmail());
    }

    AppUserActivationToken userToken =
        appUserActivationTokenRepository
            .findByTokenHashAndUsedFalse(hash)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_TOKEN"));
    if (userToken.getExpiresAt().isBefore(Instant.now())) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "TOKEN_EXPIRED");
    }
    return new ActivationTokenInfoResponse(null, null, userToken.getAppUser().getEmail());
  }

  /**
   * HU-41: activates the account behind an activation token — a {@code Professional} (existing
   * flow) or a Platform-Admin-invited tenant {@code ADMIN} {@link AppUser} (AC-2/AC-4/AC-5), tried
   * in that order, same as {@link #validateActivationToken}.
   */
  @Transactional
  public void activateAccount(ActivateProfessionalRequest request) {
    validatePasswordStrength(request.password());
    if (!request.password().equals(request.confirmPassword())) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "PASSWORDS_DO_NOT_MATCH");
    }

    String hash = sha256Hex(request.token());
    Optional<ProfessionalActivationToken> professionalToken =
        activationTokenRepository.findByTokenHashAndUsedFalse(hash);
    if (professionalToken.isPresent()) {
      activateProfessionalAccount(professionalToken.get(), request.password());
      return;
    }

    AppUserActivationToken userToken =
        appUserActivationTokenRepository
            .findByTokenHashAndUsedFalse(hash)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_TOKEN"));
    if (userToken.getExpiresAt().isBefore(Instant.now())) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "TOKEN_EXPIRED");
    }

    AppUser user = userToken.getAppUser();
    user.setPasswordHash(passwordEncoder.encode(request.password()));
    user.setEnabled(true);
    appUserRepository.save(user);

    userToken.setUsed(true);
    appUserActivationTokenRepository.save(userToken);
  }

  private void activateProfessionalAccount(
      ProfessionalActivationToken activationToken, String rawPassword) {
    if (activationToken.getExpiresAt().isBefore(Instant.now())) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "TOKEN_EXPIRED");
    }

    Professional professional = activationToken.getProfessional();
    String email = professional.getEmail().trim().toLowerCase();
    long tenantId = professional.getTenant().getId();

    AppUser user;
    Optional<AppUser> existing = appUserRepository.findByEmailAndTenant_Id(email, tenantId);
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
    user.setPasswordHash(passwordEncoder.encode(rawPassword));
    appUserRepository.save(user);

    professional.setUser(user);
    professional.setSystemAccessAllowed(true);
    professionalRepository.save(professional);

    activationToken.setUsed(true);
    activationTokenRepository.save(activationToken);
  }

  public static void validatePasswordStrength(String password) {
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

  private Tenant resolveTenant(String origin) {
    String host = extractHost(origin);
    if (host != null) {
      Optional<Tenant> byDomain = tenantRepository.findByDomain(host);
      if (byDomain.isPresent()) {
        return byDomain.get();
      }
    }
    return tenantRepository
        .findById(1L)
        .orElseThrow(
            () ->
                new ResponseStatusException(
                    HttpStatus.INTERNAL_SERVER_ERROR, "DEFAULT_TENANT_NOT_FOUND"));
  }

  private static String extractHost(String origin) {
    if (origin == null || origin.isBlank()) return null;
    try {
      return URI.create(origin).getHost();
    } catch (Exception e) {
      return null;
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
