package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.AppUser;
import com.cursorpoc.backend.domain.AppUserActivationToken;
import com.cursorpoc.backend.domain.AppUserStatusChange;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.repository.AppUserActivationTokenRepository;
import com.cursorpoc.backend.repository.AppUserRepository;
import com.cursorpoc.backend.repository.AppUserStatusChangeRepository;
import com.cursorpoc.backend.repository.ProfessionalActivationTokenRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.web.dto.AppUserStatusUpdateRequest;
import com.cursorpoc.backend.web.dto.CreateTenantAdminRequest;
import com.cursorpoc.backend.web.dto.CreateTenantAdminResponse;
import com.cursorpoc.backend.web.dto.ResendInvitationResponse;
import com.cursorpoc.backend.web.dto.TenantUserResponse;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * HU-41/HU-43 (Épica C — Gestión de usuarios y admins de tenant): Platform Admin creates a new
 * tenant-scoped {@code ADMIN} user and invites them to activate their own account. Reuses the same
 * activation-link entity/page pattern as {@code ProfessionalActivationToken}/{@code ActivatePage}
 * (AC-4) — {@link AuthService#validateActivationToken} and {@link AuthService#activateAccount}
 * transparently handle both professional- and app-user-scoped tokens, so the frontend needs no
 * branching between the two invite flows. HU-43 adds the ability to deactivate/reactivate a single
 * tenant user without affecting the rest of the tenant's admins. HU-44 adds resending that
 * activation invite, or triggering a password reset for a user who already activated but lost
 * access.
 */
@Service
public class PlatformUserAdminService {

  private static final Logger log = LoggerFactory.getLogger(PlatformUserAdminService.class);

  @Value("${app.frontend.url}")
  private String frontendUrl;

  private final TenantRepository tenantRepository;
  private final AppUserRepository appUserRepository;
  private final AppUserActivationTokenRepository activationTokenRepository;
  private final ProfessionalActivationTokenRepository professionalActivationTokenRepository;
  private final AppUserStatusChangeRepository appUserStatusChangeRepository;
  private final PasswordEncoder passwordEncoder;
  private final EmailService emailService;
  private final FemmeTimeProperties timeProperties;
  private final AuthService authService;

  public PlatformUserAdminService(
      TenantRepository tenantRepository,
      AppUserRepository appUserRepository,
      AppUserActivationTokenRepository activationTokenRepository,
      ProfessionalActivationTokenRepository professionalActivationTokenRepository,
      AppUserStatusChangeRepository appUserStatusChangeRepository,
      PasswordEncoder passwordEncoder,
      EmailService emailService,
      FemmeTimeProperties timeProperties,
      AuthService authService) {
    this.tenantRepository = tenantRepository;
    this.appUserRepository = appUserRepository;
    this.activationTokenRepository = activationTokenRepository;
    this.professionalActivationTokenRepository = professionalActivationTokenRepository;
    this.appUserStatusChangeRepository = appUserStatusChangeRepository;
    this.passwordEncoder = passwordEncoder;
    this.emailService = emailService;
    this.timeProperties = timeProperties;
    this.authService = authService;
  }

  /**
   * AC-1: creates a tenant-scoped {@code ADMIN} {@link AppUser}. AC-2: the password hash is an
   * unusable random placeholder — nobody, not even the Platform Admin, ever sees a real password;
   * the invited user sets their own at activation. AC-3: rejects a duplicate {@code (tenant_id,
   * email)} pair, same uniqueness criterion as the rest of the app. AC-4: emails an activation
   * link, same pattern as {@code AuthService#grantProfessionalAccess}. AC-5: the user stays
   * disabled — cannot log in — until activation completes. AC-6: the returned response is the
   * confirmation shown to the Platform Admin.
   */
  @Transactional
  public CreateTenantAdminResponse createTenantAdmin(
      Long tenantId, CreateTenantAdminRequest request, Locale locale) {
    Tenant tenant =
        tenantRepository
            .findById(tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "TENANT_NOT_FOUND"));

    String email = request.email() == null ? "" : request.email().trim().toLowerCase();
    if (email.isBlank()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "TENANT_ADMIN_EMAIL_REQUIRED");
    }

    // AC-3: scoped to (tenant_id, email) only — the same email may already be an admin of a
    // *different* tenant (AppUser's unique constraint is per-tenant, not global).
    if (appUserRepository.findByEmailAndTenant_Id(email, tenantId).isPresent()) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "TENANT_ADMIN_EMAIL_DUPLICATE");
    }

    AppUser user = new AppUser();
    user.setTenant(tenant);
    user.setEmail(email);
    user.setRole(UserRole.ADMIN);
    user.setPasswordHash(passwordEncoder.encode(UUID.randomUUID().toString()));
    user.setEnabled(false);
    appUserRepository.save(user);

    String raw = UUID.randomUUID().toString();
    AppUserActivationToken token = new AppUserActivationToken();
    token.setAppUser(user);
    token.setTokenHash(AuthService.sha256Hex(raw));
    token.setExpiresAt(Instant.now().plus(48, ChronoUnit.HOURS));
    token.setUsed(false);
    activationTokenRepository.save(token);

    String activationUrl = frontendUrl + "/activate?token=" + raw;
    emailService.sendActivationLink(email, activationUrl, locale);

    log.info(
        "tenant admin created tenantId={} userId={} invitationSent=true", tenantId, user.getId());

    return new CreateTenantAdminResponse(user.getId(), user.getEmail(), true, raw);
  }

  /**
   * HU-42 AC-3: lists every user (admins and professionals with login access) assigned to a tenant,
   * so the Platform Admin can confirm that more than one {@code ADMIN} was assigned (AC-1) —
   * repeating {@link #createTenantAdmin} has no artificial cap — and that each keeps independent
   * credentials (AC-4, verified end-to-end via login, not by this read-only listing).
   */
  @Transactional(readOnly = true)
  public List<TenantUserResponse> listTenantUsers(Long tenantId) {
    if (!tenantRepository.existsById(tenantId)) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "TENANT_NOT_FOUND");
    }
    return appUserRepository.findByTenant_IdOrderByRoleAscEmailAsc(tenantId).stream()
        .map(this::toTenantUserResponse)
        .toList();
  }

  /**
   * HU-43 AC-1/AC-3: flips a single tenant user's {@code enabled} flag. AC-2/AC-4 (login blocked,
   * open session invalidated on the next request) are enforced generically wherever {@code
   * AppUser#isEnabled} is already checked — {@link AuthService#login} and {@code
   * JwtAuthenticationFilter} — so this method only needs to persist the new value. AC-5: no data is
   * deleted or reassigned, only this one boolean flag changes. A no-op (value unchanged) skips the
   * audit write, same convention as {@code TenantAdminService#updateStatus}.
   */
  @Transactional
  public TenantUserResponse updateUserStatus(
      Long tenantId,
      Long userId,
      AppUserStatusUpdateRequest request,
      long changedByUserId,
      String changedByEmail) {
    if (!tenantRepository.existsById(tenantId)) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "TENANT_NOT_FOUND");
    }
    if (request.enabled() == null) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "APP_USER_STATUS_REQUIRED");
    }
    AppUser user =
        appUserRepository
            .findById(userId)
            .filter(u -> tenantId.equals(u.getTenantId()))
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "TENANT_USER_NOT_FOUND"));

    boolean previousEnabled = user.isEnabled();
    boolean newEnabled = request.enabled();
    if (previousEnabled != newEnabled) {
      user.setEnabled(newEnabled);
      appUserRepository.save(user);
      recordStatusChange(
          user.getId(), previousEnabled, newEnabled, changedByUserId, changedByEmail);
    }

    return toTenantUserResponse(user);
  }

  /**
   * HU-43 — PRD "Auditoría": same "single last result" upsert as {@code
   * TenantAdminService#recordStatusChange}, one row per app user.
   */
  private void recordStatusChange(
      Long appUserId,
      boolean previousEnabled,
      boolean newEnabled,
      long changedByUserId,
      String changedByEmail) {
    AppUserStatusChange change =
        appUserStatusChangeRepository
            .findByAppUserId(appUserId)
            .orElseGet(
                () -> {
                  AppUserStatusChange c = new AppUserStatusChange();
                  c.setAppUserId(appUserId);
                  return c;
                });
    change.setPreviousEnabled(previousEnabled);
    change.setNewEnabled(newEnabled);
    change.setChangedAt(LocalDateTime.now(timeProperties.zoneId()));
    change.setChangedByUserId(changedByUserId);
    change.setChangedByEmail(changedByEmail);
    appUserStatusChangeRepository.save(change);
  }

  /**
   * HU-44 AC-1/AC-2/AC-3/AC-4/AC-5: resends the activation invite for a user who never activated
   * their account, or triggers the "forgot password" flow for one who already did but lost access —
   * mutually exclusive, decided by {@link #hasActivated}. Either branch invalidates any previously
   * issued unused link for this user first (AC-3), so an old link stops working the moment a new
   * one is sent. A user the Platform Admin deliberately disabled (HU-43) is rejected — reactivate
   * them first, rather than emailing a reset link for an account that still can't log in.
   */
  @Transactional
  public ResendInvitationResponse resendInvitation(Long tenantId, Long userId, Locale locale) {
    if (!tenantRepository.existsById(tenantId)) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "TENANT_NOT_FOUND");
    }
    AppUser user =
        appUserRepository
            .findById(userId)
            .filter(u -> tenantId.equals(u.getTenantId()))
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "TENANT_USER_NOT_FOUND"));

    boolean activated = hasActivated(user);
    if (activated && !user.isEnabled()) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "TENANT_USER_DISABLED_CANNOT_RESEND");
    }

    if (activated) {
      // AC-2/AC-3/AC-4: already activated but lost access — trigger the same "forgot password"
      // flow the self-service ForgotPasswordPage uses, tenant-scoped since the Platform Admin isn't
      // on the tenant's own frontend to have its Origin header resolve one.
      String rawToken = authService.triggerPasswordResetForUser(user, locale);
      log.info(
          "tenant user invitation resend tenantId={} userId={} mode=PASSWORD_RESET",
          tenantId,
          userId);
      return new ResendInvitationResponse(user.getId(), user.getEmail(), true, rawToken);
    }

    // AC-1/AC-3/AC-4: never activated — invalidate any previous unused activation link and issue
    // (and email) a fresh one, same shape as the original invite in createTenantAdmin.
    activationTokenRepository.invalidateAllForAppUser(user.getId());

    String raw = UUID.randomUUID().toString();
    AppUserActivationToken token = new AppUserActivationToken();
    token.setAppUser(user);
    token.setTokenHash(AuthService.sha256Hex(raw));
    token.setExpiresAt(Instant.now().plus(48, ChronoUnit.HOURS));
    token.setUsed(false);
    activationTokenRepository.save(token);

    String activationUrl = frontendUrl + "/activate?token=" + raw;
    emailService.sendActivationLink(user.getEmail(), activationUrl, locale);

    log.info(
        "tenant user invitation resend tenantId={} userId={} mode=ACTIVATION_INVITE",
        tenantId,
        userId);
    return new ResendInvitationResponse(user.getId(), user.getEmail(), false, raw);
  }

  private TenantUserResponse toTenantUserResponse(AppUser u) {
    return new TenantUserResponse(
        u.getId(), u.getEmail(), u.getRole().name(), u.isEnabled(), hasActivated(u));
  }

  /**
   * HU-43: whether this user ever completed an activation link — either the {@code ADMIN} invite
   * flow ({@link #createTenantAdmin}) or the professional-access-grant flow ({@code
   * AuthService#grantProfessionalAccess}), whichever applies to this user's role.
   */
  private boolean hasActivated(AppUser u) {
    return activationTokenRepository.existsByAppUser_IdAndUsedTrue(u.getId())
        || professionalActivationTokenRepository.existsByProfessional_User_IdAndUsedTrue(u.getId());
  }
}
