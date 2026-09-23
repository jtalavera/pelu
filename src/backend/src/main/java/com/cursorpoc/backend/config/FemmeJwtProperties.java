package com.cursorpoc.backend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app.femme.jwt")
public class FemmeJwtProperties {

  /**
   * HS256 secret (min 32 bytes required, enforced by {@code JwtService}). RT-18
   * (Hardening_SIFEN.md): no hardcoded default — outside {@code e2e}/{@code test} this is resolved
   * from Azure Key Vault by {@code KeyVaultSecretsEnvironmentPostProcessor} before this bean is
   * even constructed; those two profiles set their own literal value directly.
   */
  private String secret;

  private long accessTokenTtlSeconds = 28_800L;

  public String getSecret() {
    return secret;
  }

  public void setSecret(String secret) {
    this.secret = secret;
  }

  public long getAccessTokenTtlSeconds() {
    return accessTokenTtlSeconds;
  }

  public void setAccessTokenTtlSeconds(long accessTokenTtlSeconds) {
    this.accessTokenTtlSeconds = accessTokenTtlSeconds;
  }
}
