package com.cursorpoc.backend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app.femme.system-admin")
public class FemmeSystemAdminProperties {

  private String email = "root@pelu";

  /** Tenant id to attach the system admin user to (FK); does not grant tenant-scoped rights. */
  private long tenantId = 1L;

  private String password = ".The.Super@admin.1982";

  public String getPassword() {
    return password;
  }

  public void setPassword(String password) {
    this.password = password;
  }

  public String getEmail() {
    return email;
  }

  public void setEmail(String email) {
    this.email = email;
  }

  public long getTenantId() {
    return tenantId;
  }

  public void setTenantId(long tenantId) {
    this.tenantId = tenantId;
  }
}
