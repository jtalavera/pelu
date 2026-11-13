package com.cursorpoc.backend.domain;

import com.cursorpoc.backend.domain.enums.CardBrand;
import com.cursorpoc.backend.domain.enums.PaymentMethod;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
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
 * A tip left for a professional after the invoice was already issued. The money never travels
 * through the invoice's payments: the row records how it was paid and the open cash session it
 * entered, so the register's expected cash and per-method breakdown include it. It counts towards
 * the professional's tip balance until it is voided; a voided row is kept (who, when, why) but no
 * longer counts.
 */
@Entity
@Table(name = "invoice_late_tips")
public class InvoiceLateTip {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "tenant_id", nullable = false)
  private Tenant tenant;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "invoice_id", nullable = false)
  private Invoice invoice;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "professional_id", nullable = false)
  private Professional professional;

  /** The cash session that was open when the tip was collected (the one the money entered). */
  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "cash_session_id", nullable = false)
  private CashSession cashSession;

  @Column(nullable = false, precision = 19, scale = 2)
  private BigDecimal amount;

  @Enumerated(EnumType.STRING)
  @Column(name = "payment_method", nullable = false, length = 20)
  private PaymentMethod paymentMethod;

  @Enumerated(EnumType.STRING)
  @Column(name = "card_brand", length = 20)
  private CardBrand cardBrand;

  @Column(name = "card_brand_other_description", length = 100)
  private String cardBrandOtherDescription;

  @ManyToOne(fetch = FetchType.LAZY)
  @JoinColumn(name = "created_by_user_id")
  private AppUser createdBy;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

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

  public Invoice getInvoice() {
    return invoice;
  }

  public void setInvoice(Invoice invoice) {
    this.invoice = invoice;
  }

  public Professional getProfessional() {
    return professional;
  }

  public void setProfessional(Professional professional) {
    this.professional = professional;
  }

  public CashSession getCashSession() {
    return cashSession;
  }

  public void setCashSession(CashSession cashSession) {
    this.cashSession = cashSession;
  }

  public BigDecimal getAmount() {
    return amount;
  }

  public void setAmount(BigDecimal amount) {
    this.amount = amount;
  }

  public PaymentMethod getPaymentMethod() {
    return paymentMethod;
  }

  public void setPaymentMethod(PaymentMethod paymentMethod) {
    this.paymentMethod = paymentMethod;
  }

  public CardBrand getCardBrand() {
    return cardBrand;
  }

  public void setCardBrand(CardBrand cardBrand) {
    this.cardBrand = cardBrand;
  }

  public String getCardBrandOtherDescription() {
    return cardBrandOtherDescription;
  }

  public void setCardBrandOtherDescription(String cardBrandOtherDescription) {
    this.cardBrandOtherDescription = cardBrandOtherDescription;
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
