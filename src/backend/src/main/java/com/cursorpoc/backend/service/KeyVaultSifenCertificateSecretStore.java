package com.cursorpoc.backend.service;

import com.azure.security.keyvault.secrets.SecretClient;
import com.azure.security.keyvault.secrets.models.KeyVaultSecret;
import java.util.Base64;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

/**
 * RT-12/RT-13/RT-14/RT-15 (Hardening_SIFEN.md): each tenant's {@code .p12} and its password become
 * native Azure Key Vault secrets — never a blob in the database, encrypted or otherwise, and never
 * a master key shared across tenants. Active outside the {@code e2e} profile (see {@link
 * LocalFileSifenCertificateSecretStore} for that one), selected by {@code
 * app.femme.keyvault.enabled}.
 *
 * <p><b>Naming (RT-13):</b> {@code sifen-cert-t<tenantId>-<uuid>-p12} / {@code -pwd} — Key Vault
 * secret names allow only {@code [0-9a-zA-Z-]}, and embedding the tenant id makes two tenants'
 * secrets structurally unable to collide, auditable by eye in the Key Vault blade. The secret
 * *version* Key Vault returns on write is persisted too (immutable per Key Vault semantics) so
 * "which bytes did we sign with" stays deterministic even if the same secret name is later
 * overwritten out-of-band.
 *
 * <p><b>Why a secret, not a Key Vault certificate:</b> {@link SifenConnectionService} needs a local
 * {@link java.security.KeyStore} with the private key in it for mTLS, and {@code
 * SifenDocumentSigningService} needs a local {@link java.security.PrivateKey} for XML-DSig —
 * neither is possible against a non-exportable Key Vault *key* object. Recovering a usable PFX from
 * a Key Vault certificate means reading the secret that backs it anyway, but with an empty-password
 * re-export that would break the {@code SIFEN_CERT_INVALID_PASSWORD} validation this app already
 * does at upload. A secret whose value is the base64 {@code .p12} plus a sibling secret for the
 * password keeps the exact tenant-supplied material and password intact.
 *
 * <p><b>Size:</b> a Key Vault secret value is capped at 25 KB — see {@link
 * SifenCertificateService#MAX_FILE_BYTES}, lowered accordingly.
 *
 * <p><b>RT-15:</b> the {@link SecretClient} bean itself is a stateless singleton (authenticates as
 * the app's one Managed Identity, same client regardless of tenant) — what must never be cached or
 * shared across tenants is *resolved* material, and this class caches nothing.
 */
@Service
@ConditionalOnProperty(
    name = "app.femme.keyvault.enabled",
    havingValue = "true",
    matchIfMissing = true)
public class KeyVaultSifenCertificateSecretStore implements SifenCertificateSecretStore {

  private final SecretClient secretClient;

  public KeyVaultSifenCertificateSecretStore(SecretClient secretClient) {
    this.secretClient = secretClient;
  }

  @Override
  public StoredSecretRef store(long tenantId, byte[] p12Bytes, String password) {
    String uuid = UUID.randomUUID().toString();
    String p12Name = secretName(tenantId, uuid, "p12");
    String passwordName = secretName(tenantId, uuid, "pwd");

    KeyVaultSecret p12Secret =
        secretClient.setSecret(
            new KeyVaultSecret(p12Name, Base64.getEncoder().encodeToString(p12Bytes)));
    KeyVaultSecret passwordSecret =
        secretClient.setSecret(new KeyVaultSecret(passwordName, password));

    return new StoredSecretRef(
        p12Name,
        p12Secret.getProperties().getVersion(),
        passwordName,
        passwordSecret.getProperties().getVersion());
  }

  @Override
  public RawCertificateMaterial load(long tenantId, StoredSecretRef ref) {
    // RT-15: never resolve a secret whose name doesn't structurally belong to this tenant — a
    // corrupted/tampered DB row can't make this call fetch another tenant's certificate.
    String expectedPrefix = "sifen-cert-t" + tenantId + "-";
    if (!ref.p12SecretName().startsWith(expectedPrefix)
        || !ref.passwordSecretName().startsWith(expectedPrefix)) {
      throw new IllegalStateException(
          "SIFEN secret ref tenant prefix mismatch for tenantId=" + tenantId);
    }
    KeyVaultSecret p12Secret = secretClient.getSecret(ref.p12SecretName(), ref.p12SecretVersion());
    KeyVaultSecret passwordSecret =
        secretClient.getSecret(ref.passwordSecretName(), ref.passwordSecretVersion());
    byte[] p12Bytes = Base64.getDecoder().decode(p12Secret.getValue());
    return new RawCertificateMaterial(p12Bytes, passwordSecret.getValue());
  }

  @Override
  public void deleteAll(long tenantId) {
    // Only ever called by SifenInvoiceTestSupportController, itself gated to the e2e profile —
    // which never selects this implementation (app.femme.keyvault.enabled=false there). Reaching
    // this means that invariant broke, so fail loudly rather than silently skip cleanup.
    throw new UnsupportedOperationException(
        "KeyVaultSifenCertificateSecretStore.deleteAll should be unreachable outside test support");
  }

  private static String secretName(long tenantId, String uuid, String suffix) {
    return "sifen-cert-t" + tenantId + "-" + uuid + "-" + suffix;
  }
}
