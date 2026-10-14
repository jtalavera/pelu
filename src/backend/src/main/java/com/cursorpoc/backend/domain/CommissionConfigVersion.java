package com.cursorpoc.backend.domain;

import com.cursorpoc.backend.domain.enums.CommissionApplyMode;
import com.cursorpoc.backend.domain.enums.CommissionConfigScope;
import com.cursorpoc.backend.domain.enums.CommissionVersionStatus;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * Módulo de comisiones: one version of a calculation input (base, defaults, periodicity or a rule).
 * For RULE a null configValue means "no rule".
 */
@Entity
@Table(name = "commission_config_versions")
public class CommissionConfigVersion {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "tenant_id", nullable = false)
  private Long tenantId;

  @Enumerated(EnumType.STRING)
  @Column(name = "scope", nullable = false, length = 32)
  private CommissionConfigScope scope;

  @Column(name = "service_id")
  private Long serviceId;

  @Column(name = "professional_id")
  private Long professionalId;

  @Column(name = "config_value", length = 32)
  private String configValue;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "effective_from", nullable = false)
  private Instant effectiveFrom;

  @Enumerated(EnumType.STRING)
  @Column(name = "apply_mode", nullable = false, length = 16)
  private CommissionApplyMode applyMode;

  @Enumerated(EnumType.STRING)
  @Column(name = "status", nullable = false, length = 16)
  private CommissionVersionStatus status;

  @Column(name = "recalculation_id")
  private Long recalculationId;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @Column(name = "created_by_email", length = 320)
  private String createdByEmail;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "cancelled_at")
  private Instant cancelledAt;

  @Column(name = "cancelled_by_email", length = 320)
  private String cancelledByEmail;

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

  public CommissionConfigScope getScope() {
    return scope;
  }

  public void setScope(CommissionConfigScope scope) {
    this.scope = scope;
  }

  public Long getServiceId() {
    return serviceId;
  }

  public void setServiceId(Long serviceId) {
    this.serviceId = serviceId;
  }

  public Long getProfessionalId() {
    return professionalId;
  }

  public void setProfessionalId(Long professionalId) {
    this.professionalId = professionalId;
  }

  public String getConfigValue() {
    return configValue;
  }

  public void setConfigValue(String configValue) {
    this.configValue = configValue;
  }

  public Instant getEffectiveFrom() {
    return effectiveFrom;
  }

  public void setEffectiveFrom(Instant effectiveFrom) {
    this.effectiveFrom = effectiveFrom;
  }

  public CommissionApplyMode getApplyMode() {
    return applyMode;
  }

  public void setApplyMode(CommissionApplyMode applyMode) {
    this.applyMode = applyMode;
  }

  public CommissionVersionStatus getStatus() {
    return status;
  }

  public void setStatus(CommissionVersionStatus status) {
    this.status = status;
  }

  public Long getRecalculationId() {
    return recalculationId;
  }

  public void setRecalculationId(Long recalculationId) {
    this.recalculationId = recalculationId;
  }

  public Instant getCreatedAt() {
    return createdAt;
  }

  public void setCreatedAt(Instant createdAt) {
    this.createdAt = createdAt;
  }

  public String getCreatedByEmail() {
    return createdByEmail;
  }

  public void setCreatedByEmail(String createdByEmail) {
    this.createdByEmail = createdByEmail;
  }

  public Instant getCancelledAt() {
    return cancelledAt;
  }

  public void setCancelledAt(Instant cancelledAt) {
    this.cancelledAt = cancelledAt;
  }

  public String getCancelledByEmail() {
    return cancelledByEmail;
  }

  public void setCancelledByEmail(String cancelledByEmail) {
    this.cancelledByEmail = cancelledByEmail;
  }
}
