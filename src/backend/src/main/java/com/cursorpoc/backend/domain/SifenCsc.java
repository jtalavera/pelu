package com.cursorpoc.backend.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.time.Instant;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * SIFEN: a tenant's Código de Seguridad del Contribuyente (CSC). The DNIT issues a distinct CSC to
 * each taxpayer and uses it to validate every QR hash, so each tenant keeps its own. The secret
 * value itself lives in {@code SifenCscSecretStore} (Azure Key Vault outside the {@code e2e}
 * profile) — this row only holds the DNIT-assigned {@link #idCsc} and a pointer to the secret.
 */
@Entity
@Table(
    name = "sifen_csc",
    uniqueConstraints = @UniqueConstraint(columnNames = {"tenant_id", "id_csc"}))
public class SifenCsc {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "tenant_id", nullable = false)
  private Tenant tenant;

  /** The "IdCSC" the DNIT assigns (printed as 4 digits in the QR). */
  @Column(name = "id_csc", nullable = false)
  private int idCsc;

  /** Name of the secret holding the CSC value — never the value itself. */
  @Column(name = "secret_name", length = 127, nullable = false)
  private String secretName;

  /** Immutable secret version, pinned so "which CSC signed this QR" stays deterministic. */
  @Column(name = "secret_version", length = 64, nullable = false)
  private String secretVersion;

  /** Whether this is the CSC used to sign the QR (at most one per tenant). */
  @Column(nullable = false)
  private boolean active;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "updated_at", nullable = false)
  private Instant updatedAt;

  @Column(name = "updated_by_user_id")
  private Long updatedByUserId;

  public Long getId() {
    return id;
  }

  public Tenant getTenant() {
    return tenant;
  }

  public void setTenant(Tenant tenant) {
    this.tenant = tenant;
  }

  public int getIdCsc() {
    return idCsc;
  }

  public void setIdCsc(int idCsc) {
    this.idCsc = idCsc;
  }

  public String getSecretName() {
    return secretName;
  }

  public void setSecretName(String secretName) {
    this.secretName = secretName;
  }

  public String getSecretVersion() {
    return secretVersion;
  }

  public void setSecretVersion(String secretVersion) {
    this.secretVersion = secretVersion;
  }

  public boolean isActive() {
    return active;
  }

  public void setActive(boolean active) {
    this.active = active;
  }

  public Instant getCreatedAt() {
    return createdAt;
  }

  public void setCreatedAt(Instant createdAt) {
    this.createdAt = createdAt;
  }

  public Instant getUpdatedAt() {
    return updatedAt;
  }

  public void setUpdatedAt(Instant updatedAt) {
    this.updatedAt = updatedAt;
  }

  public Long getUpdatedByUserId() {
    return updatedByUserId;
  }

  public void setUpdatedByUserId(Long updatedByUserId) {
    this.updatedByUserId = updatedByUserId;
  }
}
