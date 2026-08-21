package com.cursorpoc.backend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * HU-57: email/password for the very first {@code PLATFORM_ADMIN} user, created once by {@code
 * PlatformAdminBootstrap} the first time the system boots with zero {@code PLATFORM_ADMIN} users in
 * the database — see the PRD's "Sin seed hardcodeado" exception. There is no {@code tenantId} here
 * — a Platform Admin is genuinely tenant-independent (unlike the legacy tenant-bound system-admin
 * operator that HU-36 retired).
 *
 * <p>Deliberately no default values: per HU-57 AC-1 these must come only from the environment
 * ({@code APP_FEMME_PLATFORM_ADMIN_EMAIL} / {@code APP_FEMME_PLATFORM_ADMIN_PASSWORD}, bound via
 * Spring Boot's standard relaxed env-var binding — no property placeholder needed), never a
 * hardcoded value in code. If either is left unset when the bootstrap actually needs to run, {@code
 * PlatformAdminBootstrap} logs an error and skips creating the user rather than falling back to an
 * insecure literal.
 */
@ConfigurationProperties(prefix = "app.femme.platform-admin")
public class FemmePlatformAdminProperties {

  private String email;

  private String password;

  public String getEmail() {
    return email;
  }

  public void setEmail(String email) {
    this.email = email;
  }

  public String getPassword() {
    return password;
  }

  public void setPassword(String password) {
    this.password = password;
  }
}
