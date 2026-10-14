package com.cursorpoc.backend.domain;

import com.cursorpoc.backend.domain.enums.CommissionBaseType;
import com.cursorpoc.backend.domain.enums.CommissionEntrySource;
import com.cursorpoc.backend.domain.enums.CommissionRuleOrigin;
import com.cursorpoc.backend.domain.enums.ServiceKind;
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

/**
 * Módulo de comisiones: append-only ledger entry (P2/P3). Only settlementId is ever updated.
 * Idempotency per (invoice_line_id, source_type, revision) is a filtered unique index in V80 (SQL
 * Server); H2 in MSSQL mode treats NULLs as equal, so the mapping does not declare it.
 */
@Entity
@Table(name = "commission_entries")
public class CommissionEntry {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "tenant_id", nullable = false)
  private Long tenantId;

  @Column(name = "professional_id", nullable = false)
  private Long professionalId;

  @Enumerated(EnumType.STRING)
  @Column(name = "source_type", nullable = false, length = 16)
  private CommissionEntrySource sourceType;

  @Column(name = "revision", nullable = false)
  private int revision;

  @Column(name = "reason_code", length = 32)
  private String reasonCode;

  @Column(name = "invoice_id")
  private Long invoiceId;

  @Column(name = "invoice_line_id")
  private Long invoiceLineId;

  @Column(name = "invoice_number", length = 32)
  private String invoiceNumber;

  @Column(name = "service_id")
  private Long serviceId;

  @Column(name = "item_name", length = 255)
  private String itemName;

  @Enumerated(EnumType.STRING)
  @Column(name = "item_kind", length = 16)
  private ServiceKind itemKind;

  @Enumerated(EnumType.STRING)
  @Column(name = "base_type", length = 16)
  private CommissionBaseType baseType;

  @Column(name = "line_total", precision = 19, scale = 2)
  private BigDecimal lineTotal;

  @Column(name = "tax_amount", precision = 19, scale = 4)
  private BigDecimal taxAmount;

  @Column(name = "base_amount", precision = 19, scale = 2)
  private BigDecimal baseAmount;

  @Column(name = "percent_applied", precision = 5, scale = 2)
  private BigDecimal percentApplied;

  @Column(name = "rule_version_id")
  private Long ruleVersionId;

  @Enumerated(EnumType.STRING)
  @Column(name = "rule_origin", length = 32)
  private CommissionRuleOrigin ruleOrigin;

  @Column(name = "commission_amount", nullable = false, precision = 19, scale = 2)
  private BigDecimal commissionAmount;

  @Column(name = "currency", nullable = false, length = 3)
  private String currency;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "accrual_at", nullable = false)
  private Instant accrualAt;

  @Column(name = "reverses_entry_id")
  private Long reversesEntryId;

  @Column(name = "recalculation_id")
  private Long recalculationId;

  @Column(name = "settlement_id")
  private Long settlementId;

  @Column(name = "note", length = 500)
  private String note;

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

  public Long getProfessionalId() {
    return professionalId;
  }

  public void setProfessionalId(Long professionalId) {
    this.professionalId = professionalId;
  }

  public CommissionEntrySource getSourceType() {
    return sourceType;
  }

  public void setSourceType(CommissionEntrySource sourceType) {
    this.sourceType = sourceType;
  }

  public int getRevision() {
    return revision;
  }

  public void setRevision(int revision) {
    this.revision = revision;
  }

  public String getReasonCode() {
    return reasonCode;
  }

  public void setReasonCode(String reasonCode) {
    this.reasonCode = reasonCode;
  }

  public Long getInvoiceId() {
    return invoiceId;
  }

  public void setInvoiceId(Long invoiceId) {
    this.invoiceId = invoiceId;
  }

  public Long getInvoiceLineId() {
    return invoiceLineId;
  }

  public void setInvoiceLineId(Long invoiceLineId) {
    this.invoiceLineId = invoiceLineId;
  }

  public String getInvoiceNumber() {
    return invoiceNumber;
  }

  public void setInvoiceNumber(String invoiceNumber) {
    this.invoiceNumber = invoiceNumber;
  }

  public Long getServiceId() {
    return serviceId;
  }

  public void setServiceId(Long serviceId) {
    this.serviceId = serviceId;
  }

  public String getItemName() {
    return itemName;
  }

  public void setItemName(String itemName) {
    this.itemName = itemName;
  }

  public ServiceKind getItemKind() {
    return itemKind;
  }

  public void setItemKind(ServiceKind itemKind) {
    this.itemKind = itemKind;
  }

  public CommissionBaseType getBaseType() {
    return baseType;
  }

  public void setBaseType(CommissionBaseType baseType) {
    this.baseType = baseType;
  }

  public BigDecimal getLineTotal() {
    return lineTotal;
  }

  public void setLineTotal(BigDecimal lineTotal) {
    this.lineTotal = lineTotal;
  }

  public BigDecimal getTaxAmount() {
    return taxAmount;
  }

  public void setTaxAmount(BigDecimal taxAmount) {
    this.taxAmount = taxAmount;
  }

  public BigDecimal getBaseAmount() {
    return baseAmount;
  }

  public void setBaseAmount(BigDecimal baseAmount) {
    this.baseAmount = baseAmount;
  }

  public BigDecimal getPercentApplied() {
    return percentApplied;
  }

  public void setPercentApplied(BigDecimal percentApplied) {
    this.percentApplied = percentApplied;
  }

  public Long getRuleVersionId() {
    return ruleVersionId;
  }

  public void setRuleVersionId(Long ruleVersionId) {
    this.ruleVersionId = ruleVersionId;
  }

  public CommissionRuleOrigin getRuleOrigin() {
    return ruleOrigin;
  }

  public void setRuleOrigin(CommissionRuleOrigin ruleOrigin) {
    this.ruleOrigin = ruleOrigin;
  }

  public BigDecimal getCommissionAmount() {
    return commissionAmount;
  }

  public void setCommissionAmount(BigDecimal commissionAmount) {
    this.commissionAmount = commissionAmount;
  }

  public String getCurrency() {
    return currency;
  }

  public void setCurrency(String currency) {
    this.currency = currency;
  }

  public Instant getAccrualAt() {
    return accrualAt;
  }

  public void setAccrualAt(Instant accrualAt) {
    this.accrualAt = accrualAt;
  }

  public Long getReversesEntryId() {
    return reversesEntryId;
  }

  public void setReversesEntryId(Long reversesEntryId) {
    this.reversesEntryId = reversesEntryId;
  }

  public Long getRecalculationId() {
    return recalculationId;
  }

  public void setRecalculationId(Long recalculationId) {
    this.recalculationId = recalculationId;
  }

  public Long getSettlementId() {
    return settlementId;
  }

  public void setSettlementId(Long settlementId) {
    this.settlementId = settlementId;
  }

  public String getNote() {
    return note;
  }

  public void setNote(String note) {
    this.note = note;
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
