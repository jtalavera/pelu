package com.cursorpoc.backend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app.femme.jwt")
public class FemmeJwtProperties {

  /** HS256 secret (min 32 bytes recommended). */
  private String secret = "change-me";

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
