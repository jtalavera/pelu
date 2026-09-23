package com.cursorpoc.backend.domain;

import com.cursorpoc.backend.domain.enums.SifenNumberVoidingStatus;
import com.cursorpoc.backend.service.SifenDocumentType;
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
import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * RT-25 (Hardening_SIFEN.md): one "Inutilización de numeración" event, produced either manually by
 * a tenant {@code ADMIN} or automatically by {@code SifenNumberVoidingService} when a rejected
 * invoice leaves a document number unused — see that class's javadoc for the full rationale.
 */
@Entity
@Table(name = "sifen_number_voiding_events")
public class SifenNumberVoidingEvent {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "tenant_id", nullable = false)
  private Long tenantId;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "fiscal_stamp_id", nullable = false)
  private FiscalStamp fiscalStamp;

  /** The invoice whose rejection triggered this record — null for a manually-created one. */
  @Column(name = "invoice_id")
  private Long invoiceId;

  @Enumerated(EnumType.STRING)
  @Column(name = "document_type", nullable = false, length = 20)
  private SifenDocumentType documentType;

  @Column(name = "range_from", nullable = false)
  private int rangeFrom;

  @Column(name = "range_to", nullable = false)
  private int rangeTo;

  @Column(length = 500)
  private String reason;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false, length = 30)
  private SifenNumberVoidingStatus status;

  /** Manual Técnico V150: first 15 natural days of the month following the event. */
  @Column(name = "deadline_date", nullable = false)
  private LocalDate deadlineDate;

  @Column(name = "created_at", nullable = false)
  private LocalDateTime createdAt;

  @Column(name = "submitted_at")
  private LocalDateTime submittedAt;

  @Column(name = "result_code", length = 20)
  private String resultCode;

  @Column(length = 1000)
  private String message;

  @Column(name = "protocol_number", length = 50)
  private String protocolNumber;

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

  public FiscalStamp getFiscalStamp() {
    return fiscalStamp;
  }

  public void setFiscalStamp(FiscalStamp fiscalStamp) {
    this.fiscalStamp = fiscalStamp;
  }

  public Long getInvoiceId() {
    return invoiceId;
  }

  public void setInvoiceId(Long invoiceId) {
    this.invoiceId = invoiceId;
  }

  public SifenDocumentType getDocumentType() {
    return documentType;
  }

  public void setDocumentType(SifenDocumentType documentType) {
    this.documentType = documentType;
  }

  public int getRangeFrom() {
    return rangeFrom;
  }

  public void setRangeFrom(int rangeFrom) {
    this.rangeFrom = rangeFrom;
  }

  public int getRangeTo() {
    return rangeTo;
  }

  public void setRangeTo(int rangeTo) {
    this.rangeTo = rangeTo;
  }

  public String getReason() {
    return reason;
  }

  public void setReason(String reason) {
    this.reason = reason;
  }

  public SifenNumberVoidingStatus getStatus() {
    return status;
  }

  public void setStatus(SifenNumberVoidingStatus status) {
    this.status = status;
  }

  public LocalDate getDeadlineDate() {
    return deadlineDate;
  }

  public void setDeadlineDate(LocalDate deadlineDate) {
    this.deadlineDate = deadlineDate;
  }

  public LocalDateTime getCreatedAt() {
    return createdAt;
  }

  public void setCreatedAt(LocalDateTime createdAt) {
    this.createdAt = createdAt;
  }

  public LocalDateTime getSubmittedAt() {
    return submittedAt;
  }

  public void setSubmittedAt(LocalDateTime submittedAt) {
    this.submittedAt = submittedAt;
  }

  public String getResultCode() {
    return resultCode;
  }

  public void setResultCode(String resultCode) {
    this.resultCode = resultCode;
  }

  public String getMessage() {
    return message;
  }

  public void setMessage(String message) {
    this.message = message;
  }

  public String getProtocolNumber() {
    return protocolNumber;
  }

  public void setProtocolNumber(String protocolNumber) {
    this.protocolNumber = protocolNumber;
  }
}
