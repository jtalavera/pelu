package com.cursorpoc.backend.bootstrap;

import com.cursorpoc.backend.config.FemmePlatformAdminProperties;
import com.cursorpoc.backend.domain.AppUser;
import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.repository.AppUserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

/**
 * HU-57: the one and only production-safe bootstrap seed left in the system — see the PRD's "Sin
 * seed hardcodeado" definition, whose single explicit exception is the very first Platform Admin.
 *
 * <p>Unlike {@code FemmeDataInitializer}'s {@code femmeSeed} runner (feature flags, tiers, the demo
 * tenant's admin user), this bootstrap is <b>not</b> gated by {@code femme.data-init.enabled} — it
 * must behave identically whether that dev/e2e-only flag is on or off, because production never
 * sets it and still needs a way in on a fresh deployment. It replaces the old {@code
 * platform-admin@pelu} convenience seed that used to live inside {@code femmeSeed} (HU-34), which
 * only ever ran under that flag.
 *
 * <p>Idempotency (AC-3) is enforced by checking for ANY existing {@code PLATFORM_ADMIN}, not just
 * one matching the configured email — once a single Platform Admin exists, by any means (this
 * bootstrap, another Platform Admin creating one via the platform UI/API, HU-36's SYSTEM_ADMIN
 * migration, ...), this class never creates or modifies another one. That also keeps this the only
 * seed path (AC-4): everything after the first Platform Admin flows through platform UI/API.
 */
@Component
public class PlatformAdminBootstrap {

  private static final Logger log = LoggerFactory.getLogger(PlatformAdminBootstrap.class);

  private final AppUserRepository appUserRepository;
  private final FemmePlatformAdminProperties platformAdminProperties;
  private final PasswordEncoder passwordEncoder;

  public PlatformAdminBootstrap(
      AppUserRepository appUserRepository,
      FemmePlatformAdminProperties platformAdminProperties,
      PasswordEncoder passwordEncoder) {
    this.appUserRepository = appUserRepository;
    this.platformAdminProperties = platformAdminProperties;
    this.passwordEncoder = passwordEncoder;
  }

  /**
   * Creates exactly one {@code PLATFORM_ADMIN} (tenant {@code null}) from {@link
   * FemmePlatformAdminProperties} if, and only if, none exists yet in the database (AC-1). If the
   * required email/password configuration is missing at that point, logs an error and skips rather
   * than crash-looping the whole boot or falling back to a hardcoded credential — an operator can
   * set the env vars and restart. Never touches the database at all once a Platform Admin already
   * exists (AC-3).
   */
  public void bootstrapIfNeeded() {
    if (appUserRepository.existsByRole(UserRole.PLATFORM_ADMIN)) {
      log.info(
          "Platform admin bootstrap: a PLATFORM_ADMIN already exists — skipping (idempotent).");
      return;
    }

    String email = platformAdminProperties.getEmail();
    String password = platformAdminProperties.getPassword();
    if (email == null || email.isBlank() || password == null || password.isBlank()) {
      log.error(
          "Platform admin bootstrap: no PLATFORM_ADMIN exists yet and "
              + "APP_FEMME_PLATFORM_ADMIN_EMAIL / APP_FEMME_PLATFORM_ADMIN_PASSWORD are not both "
              + "set. Skipping bootstrap — there is no way into the platform until these are "
              + "configured and the app is restarted. See README.md for details.");
      return;
    }

    AppUser platformAdmin = new AppUser();
    platformAdmin.setTenant(null);
    platformAdmin.setEmail(email.trim().toLowerCase());
    platformAdmin.setPasswordHash(passwordEncoder.encode(password));
    platformAdmin.setRole(UserRole.PLATFORM_ADMIN);
    appUserRepository.save(platformAdmin);
    log.info(
        "Platform admin bootstrap: created the initial PLATFORM_ADMIN user {} (no tenant).",
        platformAdmin.getEmail());
  }
}
