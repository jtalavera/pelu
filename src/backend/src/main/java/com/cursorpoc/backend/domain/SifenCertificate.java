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
   * Base64 of AES-GCM(nonce || ciphertext || tag) over the raw .p12 file bytes. Matches Flyway:
   * NVARCHAR(MAX). Do not use @Lob — SQL Server maps LOB to CLOB and validation fails (see
   * BusinessProfile.logoDataUrl).
   */
  @Column(name = "encrypted_p12_base64", columnDefinition = "NVARCHAR(MAX)", nullable = false)
  private String encryptedP12Base64;

  /** Same AES-GCM scheme as {@link #encryptedP12Base64}, applied to the keystore password. */
  @Column(name = "encrypted_password_base64", columnDefinition = "NVARCHAR(MAX)", nullable = false)
  private String encryptedPasswordBase64;

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

  public String getEncryptedP12Base64() {
    return encryptedP12Base64;
  }

  public void setEncryptedP12Base64(String encryptedP12Base64) {
    this.encryptedP12Base64 = encryptedP12Base64;
  }

  public String getEncryptedPasswordBase64() {
    return encryptedPasswordBase64;
  }

  public void setEncryptedPasswordBase64(String encryptedPasswordBase64) {
    this.encryptedPasswordBase64 = encryptedPasswordBase64;
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
