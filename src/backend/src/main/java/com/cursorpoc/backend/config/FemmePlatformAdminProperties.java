package com.cursorpoc.backend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * HU-34: bootstrap credentials for a seed {@code PLATFORM_ADMIN} user, used only where {@code
 * femme.data-init.enabled=true} (dev opt-in / e2e — see {@code FemmeDataInitializer}). Unlike
 * {@link FemmeSystemAdminProperties}, there is no {@code tenantId} here — a Platform Admin is
 * genuinely tenant-independent. A real, UI-driven bootstrap flow for production is HU-57's scope,
 * not this one.
 */
@ConfigurationProperties(prefix = "app.femme.platform-admin")
public class FemmePlatformAdminProperties {

  private String email = "platform-admin@pelu";

  private String password = ".The.Platform@admin.2026";

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
