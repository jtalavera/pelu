package com.cursorpoc.backend.domain;

import com.cursorpoc.backend.domain.enums.DiscountType;
import com.cursorpoc.backend.domain.enums.InvoiceStatus;
import com.cursorpoc.backend.domain.enums.SifenSubmissionStatus;
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
import java.time.LocalDateTime;
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

  /** Cédula u otro documento de identidad para un cliente ocasional — SIFEN HU-02 AC-05. */
  @Column(name = "client_identity_document_override", length = 32)
  private String clientIdentityDocumentOverride;

  /** Número de control (CDC), generado una sola vez y reutilizado — SIFEN HU-01 AC-06. */
  @Column(name = "sifen_control_number", length = 44)
  private String sifenControlNumber;

  /** Código de seguridad (dCodSeg) que compone el CDC — persistido para la misma razón. */
  @Column(name = "sifen_security_code", length = 9)
  private String sifenSecurityCode;

  /**
   * Primera fecha/hora de firma (A004/dFecFirma) de esta factura — persistida una sola vez y
   * reutilizada en reintentos, para que HU-06 AC-07 mida siempre contra el mismo instante, no
   * contra un "ahora" nuevo en cada intento.
   */
  @Column(name = "sifen_signed_at")
  private LocalDateTime sifenSignedAt;

  /** Resultado de SIFEN para el último intento de envío — SIFEN HU-06. */
  @Enumerated(EnumType.STRING)
  @Column(name = "sifen_submission_status", length = 32)
  private SifenSubmissionStatus sifenSubmissionStatus;

  /** dProtAut — número de trámite que devuelve SIFEN (Aprobado/Aprobado con observación). */
  @Column(name = "sifen_submission_protocol_number", length = 10)
  private String sifenSubmissionProtocolNumber;

  /** dCodRes del primer resultado devuelto por SIFEN. */
  @Column(name = "sifen_submission_result_code", length = 10)
  private String sifenSubmissionResultCode;

  /** dMsgRes de todos los resultados devueltos por SIFEN, unidos con "; ". */
  @Column(name = "sifen_submission_message", length = 2000)
  private String sifenSubmissionMessage;

  /**
   * Momento en que se recibió una respuesta real de SIFEN — permanece {@code null} mientras el
   * estado sea {@code PENDING_VERIFICATION} (AC-05: nunca se recibió respuesta).
   */
  @Column(name = "sifen_submitted_at")
  private LocalDateTime sifenSubmittedAt;

  @Column(name = "business_ruc", length = 32)
  private String businessRuc;

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

  @Column(name = "tips_amount", nullable = false, precision = 19, scale = 2)
  private BigDecimal tipsAmount = BigDecimal.ZERO;

  @ManyToOne(fetch = FetchType.LAZY)
  @JoinColumn(name = "service_record_id")
  private ServiceRecord serviceRecord;

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

  public String getClientIdentityDocumentOverride() {
    return clientIdentityDocumentOverride;
  }

  public void setClientIdentityDocumentOverride(String clientIdentityDocumentOverride) {
    this.clientIdentityDocumentOverride = clientIdentityDocumentOverride;
  }

  public String getSifenControlNumber() {
    return sifenControlNumber;
  }

  public void setSifenControlNumber(String sifenControlNumber) {
    this.sifenControlNumber = sifenControlNumber;
  }

  public String getSifenSecurityCode() {
    return sifenSecurityCode;
  }

  public void setSifenSecurityCode(String sifenSecurityCode) {
    this.sifenSecurityCode = sifenSecurityCode;
  }

  public LocalDateTime getSifenSignedAt() {
    return sifenSignedAt;
  }

  public void setSifenSignedAt(LocalDateTime sifenSignedAt) {
    this.sifenSignedAt = sifenSignedAt;
  }

  public SifenSubmissionStatus getSifenSubmissionStatus() {
    return sifenSubmissionStatus;
  }

  public void setSifenSubmissionStatus(SifenSubmissionStatus sifenSubmissionStatus) {
    this.sifenSubmissionStatus = sifenSubmissionStatus;
  }

  public String getSifenSubmissionProtocolNumber() {
    return sifenSubmissionProtocolNumber;
  }

  public void setSifenSubmissionProtocolNumber(String sifenSubmissionProtocolNumber) {
    this.sifenSubmissionProtocolNumber = sifenSubmissionProtocolNumber;
  }

  public String getSifenSubmissionResultCode() {
    return sifenSubmissionResultCode;
  }

  public void setSifenSubmissionResultCode(String sifenSubmissionResultCode) {
    this.sifenSubmissionResultCode = sifenSubmissionResultCode;
  }

  public String getSifenSubmissionMessage() {
    return sifenSubmissionMessage;
  }

  public void setSifenSubmissionMessage(String sifenSubmissionMessage) {
    this.sifenSubmissionMessage = sifenSubmissionMessage;
  }

  public LocalDateTime getSifenSubmittedAt() {
    return sifenSubmittedAt;
  }

  public void setSifenSubmittedAt(LocalDateTime sifenSubmittedAt) {
    this.sifenSubmittedAt = sifenSubmittedAt;
  }

  public String getBusinessRuc() {
    return businessRuc;
  }

  public void setBusinessRuc(String businessRuc) {
    this.businessRuc = businessRuc;
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

  public BigDecimal getTipsAmount() {
    return tipsAmount;
  }

  public void setTipsAmount(BigDecimal tipsAmount) {
    this.tipsAmount = tipsAmount;
  }

  public ServiceRecord getServiceRecord() {
    return serviceRecord;
  }

  public void setServiceRecord(ServiceRecord serviceRecord) {
    this.serviceRecord = serviceRecord;
  }
}
