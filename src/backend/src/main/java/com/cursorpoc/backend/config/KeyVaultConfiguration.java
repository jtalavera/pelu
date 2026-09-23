package com.cursorpoc.backend.config;

import com.azure.identity.DefaultAzureCredentialBuilder;
import com.azure.security.keyvault.secrets.SecretClient;
import com.azure.security.keyvault.secrets.SecretClientBuilder;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * RT-10 (Especificacion_SIFEN_Peluqueria.md)/RT-12 (Hardening_SIFEN.md): the single {@link
 * SecretClient} bean used by {@link
 * com.cursorpoc.backend.service.KeyVaultSifenCertificateSecretStore} — authenticates via {@link
 * com.azure.identity.DefaultAzureCredential} (the Container App's system-assigned Managed Identity
 * in Azure; developer credentials locally), never a connection string or access key. Only present
 * when {@code app.femme.keyvault.enabled} isn't {@code false} — see {@code
 * application-e2e.properties}/{@code application-test.properties} for the profiles that opt out
 * (RT-08).
 */
@Configuration
@ConditionalOnProperty(
    name = "app.femme.keyvault.enabled",
    havingValue = "true",
    matchIfMissing = true)
public class KeyVaultConfiguration {

  @Bean
  public SecretClient secretClient(@Value("${app.femme.keyvault.uri:}") String vaultUri) {
    if (vaultUri.isBlank()) {
      // matchIfMissing=true on this class is deliberately fail-closed (see class javadoc) — a
      // deployment that forgets FEMME_KEYVAULT_URI must not silently fall back to local storage.
      // For local dev against a real SQL Server without a real Key Vault to point at, set
      // FEMME_KEYVAULT_ENABLED=false instead (same opt-out application-e2e.properties uses).
      throw new IllegalStateException(
          "app.femme.keyvault.enabled is true but app.femme.keyvault.uri is not set — either"
              + " configure FEMME_KEYVAULT_URI or set FEMME_KEYVAULT_ENABLED=false for local"
              + " development without a real Key Vault");
    }
    return new SecretClientBuilder()
        .vaultUrl(vaultUri)
        .credential(new DefaultAzureCredentialBuilder().build())
        .buildClient();
  }
}
