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
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * HU-66: a salon device an administrator enabled as "dispositivo compartido". Its credential (only
 * the hash is stored) lets the device list the professionals and exchange a PIN for a professional
 * session — it grants no data access by itself.
 */
@Entity
@Table(name = "shared_devices")
public class SharedDevice {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "tenant_id", nullable = false)
  private Tenant tenant;

  @Column(nullable = false, length = 100)
  private String name;

  @Column(name = "token_hash", nullable = false, length = 128, unique = true)
  private String tokenHash;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @Column(name = "created_by_user_id")
  private Long createdByUserId;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "last_used_at")
  private Instant lastUsedAt;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "revoked_at")
  private Instant revokedAt;

  /** Failed PIN attempts (all professionals) in the current window. */
  @Column(name = "failed_count", nullable = false)
  private int failedCount;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "failed_window_started_at")
  private Instant failedWindowStartedAt;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "locked_until")
  private Instant lockedUntil;

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

  public String getName() {
    return name;
  }

  public void setName(String name) {
    this.name = name;
  }

  public String getTokenHash() {
    return tokenHash;
  }

  public void setTokenHash(String tokenHash) {
    this.tokenHash = tokenHash;
  }

  public Instant getCreatedAt() {
    return createdAt;
  }

  public void setCreatedAt(Instant createdAt) {
    this.createdAt = createdAt;
  }

  public Long getCreatedByUserId() {
    return createdByUserId;
  }

  public void setCreatedByUserId(Long createdByUserId) {
    this.createdByUserId = createdByUserId;
  }

  public Instant getLastUsedAt() {
    return lastUsedAt;
  }

  public void setLastUsedAt(Instant lastUsedAt) {
    this.lastUsedAt = lastUsedAt;
  }

  public Instant getRevokedAt() {
    return revokedAt;
  }

  public void setRevokedAt(Instant revokedAt) {
    this.revokedAt = revokedAt;
  }

  public int getFailedCount() {
    return failedCount;
  }

  public void setFailedCount(int failedCount) {
    this.failedCount = failedCount;
  }

  public Instant getFailedWindowStartedAt() {
    return failedWindowStartedAt;
  }

  public void setFailedWindowStartedAt(Instant failedWindowStartedAt) {
    this.failedWindowStartedAt = failedWindowStartedAt;
  }

  public Instant getLockedUntil() {
    return lockedUntil;
  }

  public void setLockedUntil(Instant lockedUntil) {
    this.lockedUntil = lockedUntil;
  }

  public boolean isRevoked() {
    return revokedAt != null;
  }

  public boolean isLockedAt(Instant now) {
    return lockedUntil != null && now.isBefore(lockedUntil);
  }
}
