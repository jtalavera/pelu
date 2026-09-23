package com.cursorpoc.backend.config;

import com.azure.identity.DefaultAzureCredentialBuilder;
import com.azure.security.keyvault.secrets.SecretClient;
import com.azure.security.keyvault.secrets.SecretClientBuilder;
import java.time.Duration;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.EnvironmentPostProcessor;
import org.springframework.boot.SpringApplication;
import org.springframework.core.Ordered;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MapPropertySource;

/**
 * RT-18 (Hardening_SIFEN.md): resolves {@code app.femme.jwt.secret} from Azure Key Vault before any
 * bean is constructed. {@link com.cursorpoc.backend.security.JwtService} derives its HMAC signing
 * key eagerly in its own constructor — deliberately, so a misconfigured/too-short secret fails the
 * boot instead of the first login — which means the secret must already be in the {@link
 * ConfigurableEnvironment} by the time the application context refreshes; a lazy resolution inside
 * {@code JwtService} would lose that safety property. Ordered to run after Spring Boot's own
 * config-data loading (so {@code application*.properties} are already in the environment and {@code
 * app.femme.keyvault.enabled} is readable), registered via {@code META-INF/spring.factories} —
 * {@link EnvironmentPostProcessor}s are still discovered that way in Spring Boot 4, unlike
 * {@code @Configuration} autoconfiguration (which moved to {@code .imports}).
 *
 * <p>No-op when {@code app.femme.keyvault.enabled=false} (the {@code e2e}/{@code test} profiles,
 * which set their own literal {@code app.femme.jwt.secret}) or when no vault URI is configured.
 * Otherwise, an unreachable Key Vault fails the boot outright after a few retries for transient
 * blips (Container Apps then crash-loops the revision) — a JWT signing secret must never silently
 * fall back to a wrong or absent value.
 */
public class KeyVaultSecretsEnvironmentPostProcessor implements EnvironmentPostProcessor, Ordered {

  private static final Logger log =
      LoggerFactory.getLogger(KeyVaultSecretsEnvironmentPostProcessor.class);

  private static final String JWT_SECRET_NAME = "app-femme-jwt-secret";

  /** Initial attempt plus 3 retries at 2s/4s/8s — mirrors spring.flyway.connect-retries' intent. */
  private static final int MAX_ATTEMPTS = 4;

  @Override
  public int getOrder() {
    return Ordered.LOWEST_PRECEDENCE;
  }

  @Override
  public void postProcessEnvironment(
      ConfigurableEnvironment environment, SpringApplication application) {
    boolean enabled = environment.getProperty("app.femme.keyvault.enabled", Boolean.class, true);
    String vaultUri = environment.getProperty("app.femme.keyvault.uri", "");
    if (!enabled || vaultUri.isBlank()) {
      return;
    }

    SecretClient secretClient = buildSecretClient(vaultUri);
    String jwtSecret = fetchWithRetry(secretClient, JWT_SECRET_NAME);
    environment
        .getPropertySources()
        .addFirst(
            new MapPropertySource("azure-key-vault", Map.of("app.femme.jwt.secret", jwtSecret)));
  }

  SecretClient buildSecretClient(String vaultUri) {
    return new SecretClientBuilder()
        .vaultUrl(vaultUri)
        .credential(new DefaultAzureCredentialBuilder().build())
        .buildClient();
  }

  private String fetchWithRetry(SecretClient secretClient, String name) {
    RuntimeException lastFailure = null;
    for (int attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return secretClient.getSecret(name).getValue();
      } catch (RuntimeException e) {
        lastFailure = e;
        log.warn(
            "Failed to fetch Key Vault secret name={} attempt={}/{} error={}",
            name,
            attempt,
            MAX_ATTEMPTS,
            e.toString());
        if (attempt < MAX_ATTEMPTS) {
          sleep(Duration.ofSeconds(1L << attempt));
        }
      }
    }
    log.error("Giving up resolving {} from Azure Key Vault after {} attempts", name, MAX_ATTEMPTS);
    throw new IllegalStateException(
        "Could not resolve " + name + " from Azure Key Vault after " + MAX_ATTEMPTS + " attempts",
        lastFailure);
  }

  // Package-visible (not private/static) so KeyVaultSecretsEnvironmentPostProcessorTest can
  // override it to skip real waiting while still exercising the actual retry/backoff logic above.
  void sleep(Duration duration) {
    try {
      Thread.sleep(duration.toMillis());
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException("Interrupted while retrying Key Vault fetch", e);
    }
  }
}
