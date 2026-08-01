package com.cursorpoc.backend.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.time.LocalDateTime;

/**
 * SIFEN HU-22 AC-05: last change of a tenant's feature-flag state — date/time, user, previous and
 * new resolved value. One row per (tenant, flag), overwritten on each change, same "single last
 * result" convention as {@code Invoice#sifenCancellationRequestedAt} etc. Deliberately a separate
 * table from {@link TenantFeatureFlag} so resetting an override (which deletes that row) doesn't
 * also erase the record of that reset.
 */
@Entity
@Table(
    name = "tenant_feature_flag_changes",
    uniqueConstraints = @UniqueConstraint(columnNames = {"tenant_id", "flag_key"}))
public class TenantFeatureFlagChange {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "tenant_id", nullable = false)
  private Long tenantId;

  @Column(name = "flag_key", nullable = false, length = 100)
  private String flagKey;

  @Column(name = "previous_enabled", nullable = false)
  private boolean previousEnabled;

  @Column(name = "new_enabled", nullable = false)
  private boolean newEnabled;

  @Column(name = "changed_at", nullable = false)
  private LocalDateTime changedAt;

  @Column(name = "changed_by_user_id", nullable = false)
  private Long changedByUserId;

  @Column(name = "changed_by_email", nullable = false, length = 320)
  private String changedByEmail;

  public Long getId() {
    return id;
  }

  public void setId(Long id) {
    this.id = id;
  }

  public Long getTenantId() {
    return tenantId;
  }

  public void setTenantId(Long tenantId) {
    this.tenantId = tenantId;
  }

  public String getFlagKey() {
    return flagKey;
  }

  public void setFlagKey(String flagKey) {
    this.flagKey = flagKey;
  }

  public boolean isPreviousEnabled() {
    return previousEnabled;
  }

  public void setPreviousEnabled(boolean previousEnabled) {
    this.previousEnabled = previousEnabled;
  }

  public boolean isNewEnabled() {
    return newEnabled;
  }

  public void setNewEnabled(boolean newEnabled) {
    this.newEnabled = newEnabled;
  }

  public LocalDateTime getChangedAt() {
    return changedAt;
  }

  public void setChangedAt(LocalDateTime changedAt) {
    this.changedAt = changedAt;
  }

  public Long getChangedByUserId() {
    return changedByUserId;
  }

  public void setChangedByUserId(Long changedByUserId) {
    this.changedByUserId = changedByUserId;
  }

  public String getChangedByEmail() {
    return changedByEmail;
  }

  public void setChangedByEmail(String changedByEmail) {
    this.changedByEmail = changedByEmail;
  }
}
