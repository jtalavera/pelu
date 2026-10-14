package com.cursorpoc.backend.domain;

import com.cursorpoc.backend.domain.enums.CommissionSettlementStatus;
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
import java.time.LocalDate;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** Módulo de comisiones: settlement of one beneficiary for a period (HU-COM-06). */
@Entity
@Table(name = "commission_settlements")
public class CommissionSettlement {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "tenant_id", nullable = false)
  private Long tenantId;

  @Column(name = "professional_id", nullable = false)
  private Long professionalId;

  @Column(name = "period_from", nullable = false)
  private LocalDate periodFrom;

  @Column(name = "period_to", nullable = false)
  private LocalDate periodTo;

  @Enumerated(EnumType.STRING)
  @Column(name = "status", nullable = false, length = 16)
  private CommissionSettlementStatus status;

  @Column(name = "total_amount", nullable = false, precision = 19, scale = 2)
  private BigDecimal totalAmount;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @Column(name = "created_by_email", length = 320)
  private String createdByEmail;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "approved_at")
  private Instant approvedAt;

  @Column(name = "approved_by_email", length = 320)
  private String approvedByEmail;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "paid_at")
  private Instant paidAt;

  @Column(name = "paid_by_email", length = 320)
  private String paidByEmail;

  @Column(name = "payment_method", length = 32)
  private String paymentMethod;

  @Column(name = "payment_reference", length = 200)
  private String paymentReference;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "voided_at")
  private Instant voidedAt;

  @Column(name = "voided_by_email", length = 320)
  private String voidedByEmail;

  @Column(name = "void_reason", length = 500)
  private String voidReason;

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

  public Long getProfessionalId() {
    return professionalId;
  }

  public void setProfessionalId(Long professionalId) {
    this.professionalId = professionalId;
  }

  public LocalDate getPeriodFrom() {
    return periodFrom;
  }

  public void setPeriodFrom(LocalDate periodFrom) {
    this.periodFrom = periodFrom;
  }

  public LocalDate getPeriodTo() {
    return periodTo;
  }

  public void setPeriodTo(LocalDate periodTo) {
    this.periodTo = periodTo;
  }

  public CommissionSettlementStatus getStatus() {
    return status;
  }

  public void setStatus(CommissionSettlementStatus status) {
    this.status = status;
  }

  public BigDecimal getTotalAmount() {
    return totalAmount;
  }

  public void setTotalAmount(BigDecimal totalAmount) {
    this.totalAmount = totalAmount;
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

  public Instant getApprovedAt() {
    return approvedAt;
  }

  public void setApprovedAt(Instant approvedAt) {
    this.approvedAt = approvedAt;
  }

  public String getApprovedByEmail() {
    return approvedByEmail;
  }

  public void setApprovedByEmail(String approvedByEmail) {
    this.approvedByEmail = approvedByEmail;
  }

  public Instant getPaidAt() {
    return paidAt;
  }

  public void setPaidAt(Instant paidAt) {
    this.paidAt = paidAt;
  }

  public String getPaidByEmail() {
    return paidByEmail;
  }

  public void setPaidByEmail(String paidByEmail) {
    this.paidByEmail = paidByEmail;
  }

  public String getPaymentMethod() {
    return paymentMethod;
  }

  public void setPaymentMethod(String paymentMethod) {
    this.paymentMethod = paymentMethod;
  }

  public String getPaymentReference() {
    return paymentReference;
  }

  public void setPaymentReference(String paymentReference) {
    this.paymentReference = paymentReference;
  }

  public Instant getVoidedAt() {
    return voidedAt;
  }

  public void setVoidedAt(Instant voidedAt) {
    this.voidedAt = voidedAt;
  }

  public String getVoidedByEmail() {
    return voidedByEmail;
  }

  public void setVoidedByEmail(String voidedByEmail) {
    this.voidedByEmail = voidedByEmail;
  }

  public String getVoidReason() {
    return voidReason;
  }

  public void setVoidReason(String voidReason) {
    this.voidReason = voidReason;
  }
}
