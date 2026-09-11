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
 * HU-46 AC-5: last change of whether a flag is included in a tier's default package — date/time,
 * user, previous and new "included" value. One row per (tier, flag), overwritten on each change,
 * same "single last result" convention as {@link TenantFeatureFlagChange}.
 */
@Entity
@Table(
    name = "tier_feature_flag_changes",
    uniqueConstraints = @UniqueConstraint(columnNames = {"tier_id", "flag_key"}))
public class TierFeatureFlagChange {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "tier_id", nullable = false)
  private Long tierId;

  @Column(name = "flag_key", nullable = false, length = 100)
  private String flagKey;

  @Column(name = "previous_included", nullable = false)
  private boolean previousIncluded;

  @Column(name = "new_included", nullable = false)
  private boolean newIncluded;

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

  public Long getTierId() {
    return tierId;
  }

  public void setTierId(Long tierId) {
    this.tierId = tierId;
  }

  public String getFlagKey() {
    return flagKey;
  }

  public void setFlagKey(String flagKey) {
    this.flagKey = flagKey;
  }

  public boolean isPreviousIncluded() {
    return previousIncluded;
  }

  public void setPreviousIncluded(boolean previousIncluded) {
    this.previousIncluded = previousIncluded;
  }

  public boolean isNewIncluded() {
    return newIncluded;
  }

  public void setNewIncluded(boolean newIncluded) {
    this.newIncluded = newIncluded;
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
