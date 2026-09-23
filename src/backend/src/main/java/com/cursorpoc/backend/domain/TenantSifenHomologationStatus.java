package com.cursorpoc.backend.domain;

import com.cursorpoc.backend.domain.enums.SifenHomologationStatus;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.LocalDateTime;

/**
 * RT-19 (Hardening_SIFEN.md): a tenant's SIFEN homologación state, one row per tenant, created only
 * once a Platform Admin explicitly records it — a missing row means {@code PENDING} with no
 * recorded marker (see {@code SifenHomologationStatusService#getStatus}), the same "absence is the
 * safe default" convention {@link TenantFeatureFlag} uses for unset overrides.
 */
@Entity
@Table(name = "tenant_sifen_homologation_status")
public class TenantSifenHomologationStatus {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "tenant_id", nullable = false, unique = true)
  private Long tenantId;

  @Enumerated(EnumType.STRING)
  @Column(name = "status", nullable = false, length = 20)
  private SifenHomologationStatus status;

  @Column(name = "marked_by_user_id", nullable = false)
  private Long markedByUserId;

  @Column(name = "marked_by_email", nullable = false, length = 320)
  private String markedByEmail;

  @Column(name = "marked_at", nullable = false)
  private LocalDateTime markedAt;

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

  public SifenHomologationStatus getStatus() {
    return status;
  }

  public void setStatus(SifenHomologationStatus status) {
    this.status = status;
  }

  public Long getMarkedByUserId() {
    return markedByUserId;
  }

  public void setMarkedByUserId(Long markedByUserId) {
    this.markedByUserId = markedByUserId;
  }

  public String getMarkedByEmail() {
    return markedByEmail;
  }

  public void setMarkedByEmail(String markedByEmail) {
    this.markedByEmail = markedByEmail;
  }

  public LocalDateTime getMarkedAt() {
    return markedAt;
  }

  public void setMarkedAt(LocalDateTime markedAt) {
    this.markedAt = markedAt;
  }
}
