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
 * HU-43 (Desactivar/reactivar usuario de tenant) — PRD "Auditoría": last change of an {@link
 * AppUser}'s enabled/disabled status — date/time, user, previous and new value. One row per app
 * user, overwritten on each change, same "single last result" convention as {@link
 * TenantStatusChange} / {@link TenantFeatureFlagChange}.
 */
@Entity
@Table(
    name = "app_user_status_changes",
    uniqueConstraints = @UniqueConstraint(columnNames = {"app_user_id"}))
public class AppUserStatusChange {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "app_user_id", nullable = false)
  private Long appUserId;

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

  public Long getAppUserId() {
    return appUserId;
  }

  public void setAppUserId(Long appUserId) {
    this.appUserId = appUserId;
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
