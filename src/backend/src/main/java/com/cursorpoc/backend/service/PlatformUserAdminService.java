package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.AppUser;
import com.cursorpoc.backend.domain.AppUserActivationToken;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.repository.AppUserActivationTokenRepository;
import com.cursorpoc.backend.repository.AppUserRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.web.dto.CreateTenantAdminRequest;
import com.cursorpoc.backend.web.dto.CreateTenantAdminResponse;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
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
 * HU-41 (Épica C — Gestión de usuarios y admins de tenant): Platform Admin creates a new
 * tenant-scoped {@code ADMIN} user and invites them to activate their own account. Reuses the same
 * activation-link entity/page pattern as {@code ProfessionalActivationToken}/{@code ActivatePage}
 * (AC-4) — {@link AuthService#validateActivationToken} and {@link AuthService#activateAccount}
 * transparently handle both professional- and app-user-scoped tokens, so the frontend needs no
 * branching between the two invite flows.
 */
@Service
public class PlatformUserAdminService {

  private static final Logger log = LoggerFactory.getLogger(PlatformUserAdminService.class);

  @Value("${app.frontend.url}")
  private String frontendUrl;

  private final TenantRepository tenantRepository;
  private final AppUserRepository appUserRepository;
  private final AppUserActivationTokenRepository activationTokenRepository;
  private final PasswordEncoder passwordEncoder;
  private final EmailService emailService;

  public PlatformUserAdminService(
      TenantRepository tenantRepository,
      AppUserRepository appUserRepository,
      AppUserActivationTokenRepository activationTokenRepository,
      PasswordEncoder passwordEncoder,
      EmailService emailService) {
    this.tenantRepository = tenantRepository;
    this.appUserRepository = appUserRepository;
    this.activationTokenRepository = activationTokenRepository;
    this.passwordEncoder = passwordEncoder;
    this.emailService = emailService;
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
}
