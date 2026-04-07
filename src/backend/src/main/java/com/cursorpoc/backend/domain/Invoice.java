package com.cursorpoc.backend.domain;

import com.cursorpoc.backend.domain.enums.DiscountType;
import com.cursorpoc.backend.domain.enums.InvoiceStatus;
import jakarta.persistence.CascadeType;
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
import jakarta.persistence.OneToMany;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "invoices")
public class Invoice {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "tenant_id", nullable = false)
  private Tenant tenant;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "fiscal_stamp_id", nullable = false)
  private FiscalStamp fiscalStamp;

  @Column(name = "invoice_number", nullable = false)
  private int invoiceNumber;

  @ManyToOne(fetch = FetchType.LAZY)
  @JoinColumn(name = "client_id")
  private Client client;

  @Column(name = "client_display_name")
  private String clientDisplayName;

  @Column(name = "client_ruc_override", length = 32)
  private String clientRucOverride;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false, length = 32)
  private InvoiceStatus status;

  @Column(nullable = false, precision = 19, scale = 2)
  private BigDecimal subtotal;

  @Enumerated(EnumType.STRING)
  @Column(name = "discount_type", length = 16)
  private DiscountType discountType;

  @Column(name = "discount_value", precision = 19, scale = 2)
  private BigDecimal discountValue;

  @Column(nullable = false, precision = 19, scale = 2)
  private BigDecimal total;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "issued_at", nullable = false)
  private Instant issuedAt;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "cash_session_id", nullable = false)
  private CashSession cashSession;

  @Column(name = "void_reason", length = 500)
  private String voidReason;

  @OneToMany(
      mappedBy = "invoice",
      cascade = CascadeType.ALL,
      orphanRemoval = true,
      fetch = FetchType.LAZY)
  private List<InvoiceLine> lines = new ArrayList<>();

  @OneToMany(
      mappedBy = "invoice",
      cascade = CascadeType.ALL,
      orphanRemoval = true,
      fetch = FetchType.LAZY)
  private List<InvoicePaymentAllocation> paymentAllocations = new ArrayList<>();

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

  public FiscalStamp getFiscalStamp() {
    return fiscalStamp;
  }

  public void setFiscalStamp(FiscalStamp fiscalStamp) {
    this.fiscalStamp = fiscalStamp;
  }

  public int getInvoiceNumber() {
    return invoiceNumber;
  }

  public void setInvoiceNumber(int invoiceNumber) {
    this.invoiceNumber = invoiceNumber;
  }

  public Client getClient() {
    return client;
  }

  public void setClient(Client client) {
    this.client = client;
  }

  public String getClientDisplayName() {
    return clientDisplayName;
  }

  public void setClientDisplayName(String clientDisplayName) {
    this.clientDisplayName = clientDisplayName;
  }

  public String getClientRucOverride() {
    return clientRucOverride;
  }

  public void setClientRucOverride(String clientRucOverride) {
    this.clientRucOverride = clientRucOverride;
  }

  public InvoiceStatus getStatus() {
    return status;
  }

  public void setStatus(InvoiceStatus status) {
    this.status = status;
  }

  public BigDecimal getSubtotal() {
    return subtotal;
  }

  public void setSubtotal(BigDecimal subtotal) {
    this.subtotal = subtotal;
  }

  public DiscountType getDiscountType() {
    return discountType;
  }

  public void setDiscountType(DiscountType discountType) {
    this.discountType = discountType;
  }

  public BigDecimal getDiscountValue() {
    return discountValue;
  }

  public void setDiscountValue(BigDecimal discountValue) {
    this.discountValue = discountValue;
  }

  public BigDecimal getTotal() {
    return total;
  }

  public void setTotal(BigDecimal total) {
    this.total = total;
  }

  public Instant getIssuedAt() {
    return issuedAt;
  }

  public void setIssuedAt(Instant issuedAt) {
    this.issuedAt = issuedAt;
  }

  public CashSession getCashSession() {
    return cashSession;
  }

  public void setCashSession(CashSession cashSession) {
    this.cashSession = cashSession;
  }

  public String getVoidReason() {
    return voidReason;
  }

  public void setVoidReason(String voidReason) {
    this.voidReason = voidReason;
  }

  public List<InvoiceLine> getLines() {
    return lines;
  }

  public void setLines(List<InvoiceLine> lines) {
    this.lines = lines;
  }

  public List<InvoicePaymentAllocation> getPaymentAllocations() {
    return paymentAllocations;
  }

  public void setPaymentAllocations(List<InvoicePaymentAllocation> paymentAllocations) {
    this.paymentAllocations = paymentAllocations;
  }
}
