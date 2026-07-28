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

  /**
   * SIFEN HU-07 AC-03: full document content ({@code xContenDE}) SIFEN returns from the consulta
   * (query) service when the CDC is found — only ever populated once a query resolves to APPROVED,
   * never by the reception service (HU-06), which doesn't return this.
   */
  @Column(name = "sifen_query_document_content", columnDefinition = "NVARCHAR(MAX)")
  private String sifenQueryDocumentContent;

  /**
   * SIFEN HU-08: {@code gCamFuFD/dCarQR} exactly as computed and embedded in the signed document
   * this system actually transmitted (persisted once, at submission time — HU-06's {@code
   * SifenInvoiceSubmissionService}) — so the KuDE PDF (AC-13/AC-14) and the revalidation button
   * (HU-09) never need to re-sign the document just to recover this URL, and can't drift from what
   * was really sent.
   */
  @Column(name = "sifen_qr_url", length = 1000)
  private String sifenQrUrl;

  /**
   * SIFEN HU-08 AC-10/AC-15: the public consultation site for the environment used to sign/send.
   */
  @Column(name = "sifen_public_consultation_url", length = 200)
  private String sifenPublicConsultationUrl;

  /**
   * SIFEN HU-10 AC-05: historical record of the last cancellation attempt — date/time, user,
   * reason, and SIFEN's own result. Overwritten on each attempt (same "single last result" pattern
   * as {@code sifenSubmissionResultCode}/{@code sifenSubmissionMessage}, not a separate audit-log
   * table). {@code sifenSubmissionStatus} only actually becomes {@code CANCELLED} once SIFEN
   * approves the event (AC-03); these fields are populated either way, including a rejection
   * (AC-04), which leaves {@code sifenSubmissionStatus} untouched.
   */
  @Column(name = "sifen_cancellation_requested_at")
  private LocalDateTime sifenCancellationRequestedAt;

  @Column(name = "sifen_cancellation_requested_by_user_id")
  private Long sifenCancellationRequestedByUserId;

  @Column(name = "sifen_cancellation_requested_by_email", length = 320)
  private String sifenCancellationRequestedByEmail;

  /** GEC003/mOtEve — the free-text reason the user provided for the cancellation. */
  @Column(name = "sifen_cancellation_reason", length = 500)
  private String sifenCancellationReason;

  @Column(name = "sifen_cancellation_result_code", length = 10)
  private String sifenCancellationResultCode;

  @Column(name = "sifen_cancellation_message", length = 2000)
  private String sifenCancellationMessage;

  /** dProtAut of the cancellation event itself (only present when SIFEN approves it). */
  @Column(name = "sifen_cancellation_protocol_number", length = 10)
  private String sifenCancellationProtocolNumber;

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

  public String getSifenQueryDocumentContent() {
    return sifenQueryDocumentContent;
  }

  public void setSifenQueryDocumentContent(String sifenQueryDocumentContent) {
    this.sifenQueryDocumentContent = sifenQueryDocumentContent;
  }

  public String getSifenQrUrl() {
    return sifenQrUrl;
  }

  public void setSifenQrUrl(String sifenQrUrl) {
    this.sifenQrUrl = sifenQrUrl;
  }

  public String getSifenPublicConsultationUrl() {
    return sifenPublicConsultationUrl;
  }

  public void setSifenPublicConsultationUrl(String sifenPublicConsultationUrl) {
    this.sifenPublicConsultationUrl = sifenPublicConsultationUrl;
  }

  public LocalDateTime getSifenCancellationRequestedAt() {
    return sifenCancellationRequestedAt;
  }

  public void setSifenCancellationRequestedAt(LocalDateTime sifenCancellationRequestedAt) {
    this.sifenCancellationRequestedAt = sifenCancellationRequestedAt;
  }

  public Long getSifenCancellationRequestedByUserId() {
    return sifenCancellationRequestedByUserId;
  }

  public void setSifenCancellationRequestedByUserId(Long sifenCancellationRequestedByUserId) {
    this.sifenCancellationRequestedByUserId = sifenCancellationRequestedByUserId;
  }

  public String getSifenCancellationRequestedByEmail() {
    return sifenCancellationRequestedByEmail;
  }

  public void setSifenCancellationRequestedByEmail(String sifenCancellationRequestedByEmail) {
    this.sifenCancellationRequestedByEmail = sifenCancellationRequestedByEmail;
  }

  public String getSifenCancellationReason() {
    return sifenCancellationReason;
  }

  public void setSifenCancellationReason(String sifenCancellationReason) {
    this.sifenCancellationReason = sifenCancellationReason;
  }

  public String getSifenCancellationResultCode() {
    return sifenCancellationResultCode;
  }

  public void setSifenCancellationResultCode(String sifenCancellationResultCode) {
    this.sifenCancellationResultCode = sifenCancellationResultCode;
  }

  public String getSifenCancellationMessage() {
    return sifenCancellationMessage;
  }

  public void setSifenCancellationMessage(String sifenCancellationMessage) {
    this.sifenCancellationMessage = sifenCancellationMessage;
  }

  public String getSifenCancellationProtocolNumber() {
    return sifenCancellationProtocolNumber;
  }

  public void setSifenCancellationProtocolNumber(String sifenCancellationProtocolNumber) {
    this.sifenCancellationProtocolNumber = sifenCancellationProtocolNumber;
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
