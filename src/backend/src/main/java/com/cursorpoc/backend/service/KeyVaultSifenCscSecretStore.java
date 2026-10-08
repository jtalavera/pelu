package com.cursorpoc.backend.service;

import com.azure.security.keyvault.secrets.SecretClient;
import com.azure.security.keyvault.secrets.models.KeyVaultSecret;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

/**
 * Each tenant's CSC is a native Azure Key Vault secret, named {@code sifen-csc-t<tenantId>-<uuid>}
 * (Key Vault names allow only {@code [0-9a-zA-Z-]}; embedding the tenant id makes two tenants'
 * secrets structurally unable to collide and auditable by eye). The immutable secret version Key
 * Vault returns on write is persisted with the name, so replacing a CSC creates a new secret and
 * never mutates the one already used to sign earlier QRs. Same selection rule as {@link
 * KeyVaultSifenCertificateSecretStore}: active unless {@code app.femme.keyvault.enabled=false}.
 */
@Service
@ConditionalOnProperty(
    name = "app.femme.keyvault.enabled",
    havingValue = "true",
    matchIfMissing = true)
public class KeyVaultSifenCscSecretStore implements SifenCscSecretStore {

  private final SecretClient secretClient;

  public KeyVaultSifenCscSecretStore(SecretClient secretClient) {
    this.secretClient = secretClient;
  }

  @Override
  public StoredCscRef store(long tenantId, String cscValue) {
    String name = "sifen-csc-t" + tenantId + "-" + UUID.randomUUID();
    KeyVaultSecret secret = secretClient.setSecret(new KeyVaultSecret(name, cscValue));
    return new StoredCscRef(name, secret.getProperties().getVersion());
  }

  @Override
  public String load(long tenantId, StoredCscRef ref) {
    // Never resolve a secret whose name doesn't structurally belong to this tenant: a corrupted or
    // tampered row can't make this call fetch another tenant's CSC.
    if (!ref.secretName().startsWith("sifen-csc-t" + tenantId + "-")) {
      throw new IllegalStateException(
          "SIFEN CSC ref tenant prefix mismatch for tenantId=" + tenantId);
    }
    return secretClient.getSecret(ref.secretName(), ref.secretVersion()).getValue();
  }

  @Override
  public void deleteAll(long tenantId) {
    // Only called from test support, which is gated to the e2e profile (that never selects this
    // implementation). Reaching this means that invariant broke — fail loudly.
    throw new UnsupportedOperationException(
        "KeyVaultSifenCscSecretStore.deleteAll should be unreachable outside test support");
  }
}
