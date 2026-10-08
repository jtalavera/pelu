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
 * The {@code e2e}/{@code test} profiles keep CSC values in local files (one per secret, under a
 * per-tenant directory) instead of depending on a real Key Vault — same approach and naming
 * convention as {@link LocalFileSifenCertificateSecretStore}, so the tenant-prefix check in {@link
 * #load} exercises the same logic as in production. Active only when {@code
 * app.femme.keyvault.enabled=false}.
 */
@Service
@ConditionalOnProperty(name = "app.femme.keyvault.enabled", havingValue = "false")
public class LocalFileSifenCscSecretStore implements SifenCscSecretStore {

  private final Path baseDir;

  public LocalFileSifenCscSecretStore(
      @Value("${app.femme.sifen.local-store-dir:${java.io.tmpdir}/femme-sifen-certs}")
          String baseDir) {
    this.baseDir = Path.of(baseDir);
  }

  @Override
  public StoredCscRef store(long tenantId, String cscValue) {
    String name = "sifen-csc-t" + tenantId + "-" + UUID.randomUUID();
    try {
      Path tenantDir = baseDir.resolve("t" + tenantId);
      Files.createDirectories(tenantDir);
      Files.write(tenantDir.resolve(name), cscValue.getBytes(StandardCharsets.UTF_8));
    } catch (IOException e) {
      throw new UncheckedIOException("Failed to store SIFEN CSC locally", e);
    }
    return new StoredCscRef(name, "1");
  }

  @Override
  public String load(long tenantId, StoredCscRef ref) {
    if (!ref.secretName().startsWith("sifen-csc-t" + tenantId + "-")) {
      throw new IllegalStateException(
          "SIFEN CSC ref tenant prefix mismatch for tenantId=" + tenantId);
    }
    try {
      return new String(
          Files.readAllBytes(baseDir.resolve("t" + tenantId).resolve(ref.secretName())),
          StandardCharsets.UTF_8);
    } catch (IOException e) {
      throw new UncheckedIOException(
          "Failed to load locally-stored SIFEN CSC for tenantId=" + tenantId, e);
    }
  }

  @Override
  public void deleteAll(long tenantId) {
    Path tenantDir = baseDir.resolve("t" + tenantId);
    if (!Files.isDirectory(tenantDir)) {
      return;
    }
    try (var files = Files.walk(tenantDir)) {
      files
          .filter(p -> p.getFileName().toString().startsWith("sifen-csc-t"))
          .sorted(Comparator.reverseOrder())
          .forEach(
              p -> {
                try {
                  Files.deleteIfExists(p);
                } catch (IOException e) {
                  throw new UncheckedIOException(e);
                }
              });
    } catch (IOException e) {
      throw new UncheckedIOException("Failed to clear local SIFEN CSC store", e);
    }
  }
}
