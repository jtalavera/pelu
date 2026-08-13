package com.cursorpoc.backend.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.azure.security.keyvault.secrets.SecretClient;
import com.azure.security.keyvault.secrets.models.KeyVaultSecret;
import java.time.Duration;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;

/** RT-18 (Hardening_SIFEN.md). */
class KeyVaultSecretsEnvironmentPostProcessorTest {

  @Test
  void postProcessEnvironment_disabled_addsNoPropertySource() {
    StandardEnvironment env = envWith(Map.of("app.femme.keyvault.enabled", "false"));

    new KeyVaultSecretsEnvironmentPostProcessor().postProcessEnvironment(env, null);

    assertThat(env.getPropertySources().contains("azure-key-vault")).isFalse();
  }

  @Test
  void postProcessEnvironment_blankUri_addsNoPropertySource() {
    StandardEnvironment env =
        envWith(Map.of("app.femme.keyvault.enabled", "true", "app.femme.keyvault.uri", ""));

    new KeyVaultSecretsEnvironmentPostProcessor().postProcessEnvironment(env, null);

    assertThat(env.getPropertySources().contains("azure-key-vault")).isFalse();
  }

  @Test
  void postProcessEnvironment_enabled_resolvesJwtSecretAndWinsPrecedence() {
    StandardEnvironment env =
        envWith(
            Map.of(
                "app.femme.keyvault.enabled",
                "true",
                "app.femme.keyvault.uri",
                "https://fake.vault.azure.net",
                "app.femme.jwt.secret",
                "should-be-overridden-by-key-vault-value"));
    SecretClient mockClient = mock(SecretClient.class);
    when(mockClient.getSecret("app-femme-jwt-secret"))
        .thenReturn(
            new KeyVaultSecret("app-femme-jwt-secret", "kv-resolved-secret-min-32-characters!!"));
    var processor = testableProcessor(mockClient);

    processor.postProcessEnvironment(env, null);

    assertThat(env.getProperty("app.femme.jwt.secret"))
        .isEqualTo("kv-resolved-secret-min-32-characters!!");
    // addFirst means this is the property source that actually wins, not just present somewhere.
    assertThat(env.getPropertySources().iterator().next().getName()).isEqualTo("azure-key-vault");
  }

  @Test
  void postProcessEnvironment_keyVaultConsistentlyUnreachable_retriesThenFailsBoot() {
    StandardEnvironment env =
        envWith(
            Map.of(
                "app.femme.keyvault.enabled",
                "true",
                "app.femme.keyvault.uri",
                "https://fake.vault.azure.net"));
    SecretClient mockClient = mock(SecretClient.class);
    when(mockClient.getSecret("app-femme-jwt-secret"))
        .thenThrow(new RuntimeException("simulated Key Vault outage"));
    var processor = testableProcessor(mockClient);

    assertThatThrownBy(() -> processor.postProcessEnvironment(env, null))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("app-femme-jwt-secret");
    // Initial attempt + 3 retries.
    verify(mockClient, times(4)).getSecret("app-femme-jwt-secret");
  }

  private static StandardEnvironment envWith(Map<String, Object> properties) {
    StandardEnvironment env = new StandardEnvironment();
    env.getPropertySources().addFirst(new MapPropertySource("test", properties));
    return env;
  }

  /** Overrides the two side-effecting seams so the retry logic runs for real but instantly. */
  private static KeyVaultSecretsEnvironmentPostProcessor testableProcessor(SecretClient client) {
    return new KeyVaultSecretsEnvironmentPostProcessor() {
      @Override
      SecretClient buildSecretClient(String vaultUri) {
        return client;
      }

      @Override
      void sleep(Duration duration) {
        // no-op — the retry COUNT is what's under test, not real wall-clock backoff.
      }
    };
  }
}
