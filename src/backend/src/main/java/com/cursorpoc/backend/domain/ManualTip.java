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
import java.math.BigDecimal;
import java.time.Instant;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * A tip loaded by hand by the salon administrator (not generated from a ficha or a comprobante). It
 * counts towards the professional's accumulated balance until it is voided; a voided row is kept
 * (who, when, why) but no longer counts.
 */
@Entity
@Table(name = "manual_tips")
public class ManualTip {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "tenant_id", nullable = false)
  private Tenant tenant;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "professional_id", nullable = false)
  private Professional professional;

  @Column(nullable = false, precision = 19, scale = 2)
  private BigDecimal amount;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "tipped_at", nullable = false)
  private Instant tippedAt;

  @Column(length = 200)
  private String note;

  @ManyToOne(fetch = FetchType.LAZY)
  @JoinColumn(name = "created_by_user_id")
  private AppUser createdBy;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @ManyToOne(fetch = FetchType.LAZY)
  @JoinColumn(name = "updated_by_user_id")
  private AppUser updatedBy;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "updated_at")
  private Instant updatedAt;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "voided_at")
  private Instant voidedAt;

  @ManyToOne(fetch = FetchType.LAZY)
  @JoinColumn(name = "voided_by_user_id")
  private AppUser voidedBy;

  @Column(name = "void_reason", length = 200)
  private String voidReason;

  public boolean isVoided() {
    return voidedAt != null;
  }

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

  public Professional getProfessional() {
    return professional;
  }

  public void setProfessional(Professional professional) {
    this.professional = professional;
  }

  public BigDecimal getAmount() {
    return amount;
  }

  public void setAmount(BigDecimal amount) {
    this.amount = amount;
  }

  public Instant getTippedAt() {
    return tippedAt;
  }

  public void setTippedAt(Instant tippedAt) {
    this.tippedAt = tippedAt;
  }

  public String getNote() {
    return note;
  }

  public void setNote(String note) {
    this.note = note;
  }

  public AppUser getCreatedBy() {
    return createdBy;
  }

  public void setCreatedBy(AppUser createdBy) {
    this.createdBy = createdBy;
  }

  public Instant getCreatedAt() {
    return createdAt;
  }

  public void setCreatedAt(Instant createdAt) {
    this.createdAt = createdAt;
  }

  public AppUser getUpdatedBy() {
    return updatedBy;
  }

  public void setUpdatedBy(AppUser updatedBy) {
    this.updatedBy = updatedBy;
  }

  public Instant getUpdatedAt() {
    return updatedAt;
  }

  public void setUpdatedAt(Instant updatedAt) {
    this.updatedAt = updatedAt;
  }

  public Instant getVoidedAt() {
    return voidedAt;
  }

  public void setVoidedAt(Instant voidedAt) {
    this.voidedAt = voidedAt;
  }

  public AppUser getVoidedBy() {
    return voidedBy;
  }

  public void setVoidedBy(AppUser voidedBy) {
    this.voidedBy = voidedBy;
  }

  public String getVoidReason() {
    return voidReason;
  }

  public void setVoidReason(String voidReason) {
    this.voidReason = voidReason;
  }
}
