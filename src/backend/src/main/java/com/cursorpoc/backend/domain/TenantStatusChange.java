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
 * HU-40 (Suspender/reactivar tenant) — PRD "Auditoría": last change of a tenant's status — date/
 * time, user, previous and new status. One row per tenant, overwritten on each change, same "single
 * last result" convention as {@link TenantTierChange} / {@link TenantFeatureFlagChange}.
 */
@Entity
@Table(
    name = "tenant_status_changes",
    uniqueConstraints = @UniqueConstraint(columnNames = {"tenant_id"}))
public class TenantStatusChange {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "tenant_id", nullable = false)
  private Long tenantId;

  @Column(name = "previous_status", nullable = false, length = 20)
  private String previousStatus;

  @Column(name = "new_status", nullable = false, length = 20)
  private String newStatus;

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

  public String getPreviousStatus() {
    return previousStatus;
  }

  public void setPreviousStatus(String previousStatus) {
    this.previousStatus = previousStatus;
  }

  public String getNewStatus() {
    return newStatus;
  }

  public void setNewStatus(String newStatus) {
    this.newStatus = newStatus;
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
