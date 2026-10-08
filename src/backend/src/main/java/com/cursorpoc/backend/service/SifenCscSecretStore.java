package com.cursorpoc.backend.service;

/**
 * Where a tenant's CSC value actually lives. Outside the {@code e2e} profile that's Azure Key
 * Vault, one secret per CSC (see {@link KeyVaultSifenCscSecretStore}) — never the database, never a
 * value shared across tenants. The {@code e2e} profile keeps it in local files ({@link
 * LocalFileSifenCscSecretStore}). Same contract and guarantees as {@link
 * SifenCertificateSecretStore}: implementations never cache resolved values and {@link #load} is
 * handed the {@code tenantId} so it can refuse a reference that belongs to another tenant.
 */
public interface SifenCscSecretStore {

  /** Stores the CSC value; returns the pointer to persist on the {@code sifen_csc} row. */
  StoredCscRef store(long tenantId, String cscValue);

  /** Resolves the value for a row of {@code tenantId}; verifies the ref belongs to that tenant. */
  String load(long tenantId, StoredCscRef ref);

  /** Test-support only: drops everything stored for a tenant. */
  void deleteAll(long tenantId);

  record StoredCscRef(String secretName, String secretVersion) {}
}
