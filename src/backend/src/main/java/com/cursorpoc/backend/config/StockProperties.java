package com.cursorpoc.backend.config;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Stock integration (HU-60..HU-65): how pelu talks to control-stock and how control-stock talks
 * back. Secrets have no defaults — outside {@code e2e}/{@code test} they come from Azure Key Vault
 * (see {@code KeyVaultSecretsEnvironmentPostProcessor}).
 */
@ConfigurationProperties(prefix = "app.femme.stock")
public class StockProperties {

  /** Master switch for outbound calls. When false the outbox still records events, never sends. */
  private boolean enabled;

  /** control-stock API base URL, e.g. {@code https://stock-api.femme.com.py}. */
  private String baseUrl;

  /** OAuth2 client_credentials token path on control-stock. */
  private String tokenPath = "/oauth/token";

  /** M2M client pelu uses toward control-stock (control-stock's bootstrap client). */
  private String clientId = "pelu";

  private String clientSecret;

  /** Source system pelu identifies as in control-stock. */
  private String sourceSystem = "PELU";

  private Duration httpTimeout = Duration.ofSeconds(30);

  /**
   * Timeout for the catalog bulk upserts, which Stock needs far longer than the plain calls above
   * (each batch writes up to {@link #catalogBatchSize} items). With the former 10 s limit a big
   * batch timed out although Stock went on to apply it, leaving the delivery pending for hours.
   */
  private Duration bulkHttpTimeout = Duration.ofSeconds(120);

  /** Items per bulk upsert when the whole catalog is synced. */
  private int catalogBatchSize = 200;

  /** Backoff between delivery attempts; after the last one the event becomes FAILED. */
  private List<Duration> retryDelays =
      new ArrayList<>(
          List.of(
              Duration.ofMinutes(1),
              Duration.ofMinutes(5),
              Duration.ofMinutes(15),
              Duration.ofHours(1),
              Duration.ofHours(4),
              Duration.ofHours(24)));

  /** Lease a worker holds on an event while calling control-stock. */
  private Duration leaseTtl = Duration.ofMinutes(5);

  private final Sso sso = new Sso();

  private final Integration integration = new Integration();

  /** SSO handoff token toward the Stock SPA (HU-65). */
  public static class Sso {
    /** Dedicated HS256 secret shared only with control-stock (never the Femme session secret). */
    private String secret;

    private String issuer = "femme";

    private String audience = "control-stock";

    private Duration ttl = Duration.ofMinutes(5);

    public String getSecret() {
      return secret;
    }

    public void setSecret(String secret) {
      this.secret = secret;
    }

    public String getIssuer() {
      return issuer;
    }

    public void setIssuer(String issuer) {
      this.issuer = issuer;
    }

    public String getAudience() {
      return audience;
    }

    public void setAudience(String audience) {
      this.audience = audience;
    }

    public Duration getTtl() {
      return ttl;
    }

    public void setTtl(Duration ttl) {
      this.ttl = ttl;
    }
  }

  /** Inbound M2M surface ({@code /api/integration/**}) control-stock uses to pull flags (HU-61). */
  public static class Integration {
    /** The single technical user's id. */
    private String clientId = "control-stock";

    private String clientSecret;

    /** HS256 secret for the integration access tokens (own secret, not the Femme session one). */
    private String tokenSecret;

    private Duration tokenTtl = Duration.ofHours(1);

    public String getClientId() {
      return clientId;
    }

    public void setClientId(String clientId) {
      this.clientId = clientId;
    }

    public String getClientSecret() {
      return clientSecret;
    }

    public void setClientSecret(String clientSecret) {
      this.clientSecret = clientSecret;
    }

    public String getTokenSecret() {
      return tokenSecret;
    }

    public void setTokenSecret(String tokenSecret) {
      this.tokenSecret = tokenSecret;
    }

    public Duration getTokenTtl() {
      return tokenTtl;
    }

    public void setTokenTtl(Duration tokenTtl) {
      this.tokenTtl = tokenTtl;
    }
  }

  public boolean isEnabled() {
    return enabled;
  }

  public void setEnabled(boolean enabled) {
    this.enabled = enabled;
  }

  public String getBaseUrl() {
    return baseUrl;
  }

  public void setBaseUrl(String baseUrl) {
    this.baseUrl = baseUrl;
  }

  public String getTokenPath() {
    return tokenPath;
  }

  public void setTokenPath(String tokenPath) {
    this.tokenPath = tokenPath;
  }

  public String getClientId() {
    return clientId;
  }

  public void setClientId(String clientId) {
    this.clientId = clientId;
  }

  public String getClientSecret() {
    return clientSecret;
  }

  public void setClientSecret(String clientSecret) {
    this.clientSecret = clientSecret;
  }

  public String getSourceSystem() {
    return sourceSystem;
  }

  public void setSourceSystem(String sourceSystem) {
    this.sourceSystem = sourceSystem;
  }

  public Duration getHttpTimeout() {
    return httpTimeout;
  }

  public void setHttpTimeout(Duration httpTimeout) {
    this.httpTimeout = httpTimeout;
  }

  public Duration getBulkHttpTimeout() {
    return bulkHttpTimeout;
  }

  public void setBulkHttpTimeout(Duration bulkHttpTimeout) {
    this.bulkHttpTimeout = bulkHttpTimeout;
  }

  public int getCatalogBatchSize() {
    return catalogBatchSize;
  }

  public void setCatalogBatchSize(int catalogBatchSize) {
    this.catalogBatchSize = Math.max(1, catalogBatchSize);
  }

  public List<Duration> getRetryDelays() {
    return retryDelays;
  }

  public void setRetryDelays(List<Duration> retryDelays) {
    this.retryDelays = retryDelays;
  }

  public Duration getLeaseTtl() {
    return leaseTtl;
  }

  public void setLeaseTtl(Duration leaseTtl) {
    this.leaseTtl = leaseTtl;
  }

  public Sso getSso() {
    return sso;
  }

  public Integration getIntegration() {
    return integration;
  }

  /** True when outbound calls can actually be made (enabled + URL + credentials). */
  public boolean isConfigured() {
    return enabled
        && baseUrl != null
        && !baseUrl.isBlank()
        && clientSecret != null
        && !clientSecret.isBlank();
  }
}
