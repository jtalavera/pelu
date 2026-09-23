package com.cursorpoc.backend.service;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

/**
 * RT-08 (Especificacion_SIFEN_Peluqueria.md, confirmed unchanged by Hardening_SIFEN.md): the {@code
 * e2e} profile stores SIFEN certificate material locally — a file per secret, under a per-tenant
 * directory — instead of depending on a real Azure Key Vault or an emulator. Active only when
 * {@code app.femme.keyvault.enabled=false} (see {@code application-e2e.properties} / {@code
 * application-test.properties}); real deployments use {@link KeyVaultSifenCertificateSecretStore}
 * instead, selected by the same property.
 *
 * <p>File-based rather than in-memory so a local {@code bootRun} restart doesn't leave DB rows
 * pointing at material that died with the JVM. The naming convention mirrors the Key Vault
 * implementation's ({@code sifen-cert-t<tenantId>-<uuid>-p12}/{@code -pwd}) purely so the RT-15
 * tenant-prefix check in {@link #load} exercises the same logic in both environments.
 */
@Service
@ConditionalOnProperty(name = "app.femme.keyvault.enabled", havingValue = "false")
public class LocalFileSifenCertificateSecretStore implements SifenCertificateSecretStore {

  private final Path baseDir;

  public LocalFileSifenCertificateSecretStore(
      @Value("${app.femme.sifen.local-store-dir:${java.io.tmpdir}/femme-sifen-certs}")
          String baseDir) {
    this.baseDir = Path.of(baseDir);
  }

  @Override
  public StoredSecretRef store(long tenantId, byte[] p12Bytes, String password) {
    String uuid = UUID.randomUUID().toString();
    String p12Name = secretName(tenantId, uuid, "p12");
    String passwordName = secretName(tenantId, uuid, "pwd");
    try {
      Path tenantDir = baseDir.resolve("t" + tenantId);
      Files.createDirectories(tenantDir);
      Files.write(tenantDir.resolve(p12Name), p12Bytes);
      Files.write(tenantDir.resolve(passwordName), password.getBytes(StandardCharsets.UTF_8));
    } catch (IOException e) {
      throw new UncheckedIOException("Failed to store SIFEN certificate material locally", e);
    }
    return new StoredSecretRef(p12Name, "1", passwordName, "1");
  }

  @Override
  public RawCertificateMaterial load(long tenantId, StoredSecretRef ref) {
    // RT-15: a corrupted/tampered row can never make one tenant's call resolve another tenant's
    // material — same invariant the Key Vault implementation enforces.
    String expectedPrefix = "sifen-cert-t" + tenantId + "-";
    if (!ref.p12SecretName().startsWith(expectedPrefix)
        || !ref.passwordSecretName().startsWith(expectedPrefix)) {
      throw new IllegalStateException(
          "SIFEN secret ref tenant prefix mismatch for tenantId=" + tenantId);
    }
    Path tenantDir = baseDir.resolve("t" + tenantId);
    try {
      byte[] p12Bytes = Files.readAllBytes(tenantDir.resolve(ref.p12SecretName()));
      String password =
          new String(
              Files.readAllBytes(tenantDir.resolve(ref.passwordSecretName())),
              StandardCharsets.UTF_8);
      return new RawCertificateMaterial(p12Bytes, password);
    } catch (IOException e) {
      throw new UncheckedIOException(
          "Failed to load locally-stored SIFEN certificate material for tenantId=" + tenantId, e);
    }
  }

  @Override
  public void deleteAll(long tenantId) {
    Path tenantDir = baseDir.resolve("t" + tenantId);
    if (!Files.isDirectory(tenantDir)) {
      return;
    }
    try (var files = Files.walk(tenantDir)) {
      files.sorted(Comparator.reverseOrder()).forEach(this::deleteQuietly);
    } catch (IOException e) {
      throw new UncheckedIOException("Failed to clear local SIFEN certificate store", e);
    }
  }

  private void deleteQuietly(Path path) {
    try {
      Files.deleteIfExists(path);
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  private static String secretName(long tenantId, String uuid, String suffix) {
    return "sifen-cert-t" + tenantId + "-" + uuid + "-" + suffix;
  }
}
