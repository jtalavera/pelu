package com.cursorpoc.backend.service;

/**
 * RT-12/RT-13/RT-14/RT-15 (Hardening_SIFEN.md): resolves where a tenant's SIFEN {@code .p12} and
 * its password actually live. Outside the {@code e2e} profile that's Azure Key Vault, one secret
 * pair per tenant (see {@link KeyVaultSifenCertificateSecretStore}) — never a shared master key,
 * never the raw material in the database. The {@code e2e} profile keeps local storage per RT-08
 * (see {@link LocalFileSifenCertificateSecretStore}).
 *
 * <p>Only {@link SifenCertificateService} calls this — it decides *when* to store/load (upload,
 * sign, connect), this decides *where*. Implementations must never cache resolved material across
 * calls (HU-21 AC-04) and must never let one tenant's call resolve another tenant's secret (RT-15)
 * — {@link #load} is handed the {@code tenantId} precisely so it can verify that.
 */
public interface SifenCertificateSecretStore {

  /** Stores the {@code .p12} bytes and password; returns the pointer to persist on the DB row. */
  StoredSecretRef store(long tenantId, byte[] p12Bytes, String password);

  /**
   * Resolves the raw material for a row that already belongs to {@code tenantId} — implementations
   * must verify the ref actually belongs to that tenant before returning anything (RT-15).
   */
  RawCertificateMaterial load(long tenantId, StoredSecretRef ref);

  /**
   * Test-support only ({@code SifenInvoiceTestSupportController}): drops everything for a tenant.
   */
  void deleteAll(long tenantId);

  record StoredSecretRef(
      String p12SecretName,
      String p12SecretVersion,
      String passwordSecretName,
      String passwordSecretVersion) {}

  record RawCertificateMaterial(byte[] p12Bytes, String password) {}
}
