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
import java.time.Instant;
import java.time.LocalDate;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "sifen_certificates")
public class SifenCertificate {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "tenant_id", nullable = false)
  private Tenant tenant;

  /**
   * RT-12 (Hardening_SIFEN.md): the actual .p12 bytes live in {@code SifenCertificateSecretStore}
   * (Azure Key Vault outside {@code e2e}) — this is only the secret's name, never the material
   * itself. Paired with {@link #p12SecretVersion} because Key Vault secret versions are immutable,
   * so pinning both makes "which bytes did we sign with" deterministic.
   */
  @Column(name = "p12_secret_name", length = 127, nullable = false)
  private String p12SecretName;

  @Column(name = "p12_secret_version", length = 64, nullable = false)
  private String p12SecretVersion;

  /** Same reference scheme as {@link #p12SecretName}, for the keystore password's own secret. */
  @Column(name = "password_secret_name", length = 127, nullable = false)
  private String passwordSecretName;

  @Column(name = "password_secret_version", length = 64, nullable = false)
  private String passwordSecretVersion;

  @Column(name = "not_before", nullable = false)
  private LocalDate notBefore;

  @Column(name = "not_after", nullable = false)
  private LocalDate notAfter;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "uploaded_at", nullable = false)
  private Instant uploadedAt;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "uploaded_by_user_id", nullable = false)
  private AppUser uploadedBy;

  public Long getId() {
    return id;
  }

  public void setId(Long id) {
    this.id = id;
  }

  public Tenant getTenant() {
    return tenant;
  }

  public void setTenant(Tenant tenant) {
    this.tenant = tenant;
  }

  public String getP12SecretName() {
    return p12SecretName;
  }

  public void setP12SecretName(String p12SecretName) {
    this.p12SecretName = p12SecretName;
  }

  public String getP12SecretVersion() {
    return p12SecretVersion;
  }

  public void setP12SecretVersion(String p12SecretVersion) {
    this.p12SecretVersion = p12SecretVersion;
  }

  public String getPasswordSecretName() {
    return passwordSecretName;
  }

  public void setPasswordSecretName(String passwordSecretName) {
    this.passwordSecretName = passwordSecretName;
  }

  public String getPasswordSecretVersion() {
    return passwordSecretVersion;
  }

  public void setPasswordSecretVersion(String passwordSecretVersion) {
    this.passwordSecretVersion = passwordSecretVersion;
  }

  public LocalDate getNotBefore() {
    return notBefore;
  }

  public void setNotBefore(LocalDate notBefore) {
    this.notBefore = notBefore;
  }

  public LocalDate getNotAfter() {
    return notAfter;
  }

  public void setNotAfter(LocalDate notAfter) {
    this.notAfter = notAfter;
  }

  public Instant getUploadedAt() {
    return uploadedAt;
  }

  public void setUploadedAt(Instant uploadedAt) {
    this.uploadedAt = uploadedAt;
  }

  public AppUser getUploadedBy() {
    return uploadedBy;
  }

  public void setUploadedBy(AppUser uploadedBy) {
    this.uploadedBy = uploadedBy;
  }
}
