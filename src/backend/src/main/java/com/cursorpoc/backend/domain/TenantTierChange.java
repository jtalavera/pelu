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
 * HU-38 (Editar tenant) AC-6: last change of a tenant's tier — date/time, user, previous and new
 * tier. One row per tenant, overwritten on each change, same "single last result" convention as
 * {@link TenantFeatureFlagChange}.
 */
@Entity
@Table(
    name = "tenant_tier_changes",
    uniqueConstraints = @UniqueConstraint(columnNames = {"tenant_id"}))
public class TenantTierChange {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "tenant_id", nullable = false)
  private Long tenantId;

  @Column(name = "previous_tier_id")
  private Long previousTierId;

  @Column(name = "previous_tier_name", length = 100)
  private String previousTierName;

  @Column(name = "new_tier_id")
  private Long newTierId;

  @Column(name = "new_tier_name", length = 100)
  private String newTierName;

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

  public Long getPreviousTierId() {
    return previousTierId;
  }

  public void setPreviousTierId(Long previousTierId) {
    this.previousTierId = previousTierId;
  }

  public String getPreviousTierName() {
    return previousTierName;
  }

  public void setPreviousTierName(String previousTierName) {
    this.previousTierName = previousTierName;
  }

  public Long getNewTierId() {
    return newTierId;
  }

  public void setNewTierId(Long newTierId) {
    this.newTierId = newTierId;
  }

  public String getNewTierName() {
    return newTierName;
  }

  public void setNewTierName(String newTierName) {
    this.newTierName = newTierName;
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
