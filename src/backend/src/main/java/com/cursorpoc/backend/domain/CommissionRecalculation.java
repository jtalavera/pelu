package com.cursorpoc.backend.domain;

import com.cursorpoc.backend.domain.enums.CommissionConfigScope;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.Instant;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** Módulo de comisiones: audit record of a PERIOD_START recalculation (§4.4). */
@Entity
@Table(name = "commission_recalculations")
public class CommissionRecalculation {

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

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "period_from", nullable = false)
  private Instant periodFrom;

  @Column(name = "entries_recalculated", nullable = false)
  private int entriesRecalculated;

  @Column(name = "entries_excluded", nullable = false)
  private int entriesExcluded;

  @Column(name = "delta_amount", nullable = false, precision = 19, scale = 2)
  private BigDecimal deltaAmount;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @Column(name = "created_by_email", length = 320)
  private String createdByEmail;

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

  public Instant getPeriodFrom() {
    return periodFrom;
  }

  public void setPeriodFrom(Instant periodFrom) {
    this.periodFrom = periodFrom;
  }

  public int getEntriesRecalculated() {
    return entriesRecalculated;
  }

  public void setEntriesRecalculated(int entriesRecalculated) {
    this.entriesRecalculated = entriesRecalculated;
  }

  public int getEntriesExcluded() {
    return entriesExcluded;
  }

  public void setEntriesExcluded(int entriesExcluded) {
    this.entriesExcluded = entriesExcluded;
  }

  public BigDecimal getDeltaAmount() {
    return deltaAmount;
  }

  public void setDeltaAmount(BigDecimal deltaAmount) {
    this.deltaAmount = deltaAmount;
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
}
