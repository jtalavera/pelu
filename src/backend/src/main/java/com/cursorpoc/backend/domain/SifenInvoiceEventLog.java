package com.cursorpoc.backend.domain;

import com.cursorpoc.backend.domain.enums.SifenInvoiceEventType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.LocalDateTime;

/**
 * Issue #205 AC-2: one SIFEN interaction attempt for an invoice — appended, never overwritten,
 * unlike the single "last result" scalar fields on {@link Invoice}. Powers the "ver historial de
 * mensajes SIFEN" popup in the invoice detail's "Estado en SIFEN" accordion.
 */
@Entity
@Table(name = "sifen_invoice_event_log")
public class SifenInvoiceEventLog {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "tenant_id", nullable = false)
  private Long tenantId;

  @Column(name = "invoice_id", nullable = false)
  private Long invoiceId;

  @Enumerated(EnumType.STRING)
  @Column(name = "event_type", nullable = false, length = 30)
  private SifenInvoiceEventType eventType;

  @Column(name = "occurred_at", nullable = false)
  private LocalDateTime occurredAt;

  @Column(name = "result_code", length = 20)
  private String resultCode;

  @Column(length = 1000)
  private String message;

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

  public Long getInvoiceId() {
    return invoiceId;
  }

  public void setInvoiceId(Long invoiceId) {
    this.invoiceId = invoiceId;
  }

  public SifenInvoiceEventType getEventType() {
    return eventType;
  }

  public void setEventType(SifenInvoiceEventType eventType) {
    this.eventType = eventType;
  }

  public LocalDateTime getOccurredAt() {
    return occurredAt;
  }

  public void setOccurredAt(LocalDateTime occurredAt) {
    this.occurredAt = occurredAt;
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
}
