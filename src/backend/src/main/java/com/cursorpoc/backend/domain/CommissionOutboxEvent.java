package com.cursorpoc.backend.domain;

import com.cursorpoc.backend.domain.enums.CommissionOutboxStatus;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** Módulo de comisiones: invoice event pending commission processing (HU-COM-04). */
@Entity
@Table(name = "commission_outbox")
public class CommissionOutboxEvent {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "tenant_id", nullable = false)
  private Long tenantId;

  @Column(name = "invoice_id", nullable = false)
  private Long invoiceId;

  @Column(name = "event_kind", nullable = false, length = 16)
  private String eventKind;

  @Enumerated(EnumType.STRING)
  @Column(name = "status", nullable = false, length = 16)
  private CommissionOutboxStatus status;

  @Column(name = "attempt_count", nullable = false)
  private int attemptCount;

  @Column(name = "last_error", length = 2000)
  private String lastError;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "processed_at")
  private Instant processedAt;

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

  public String getEventKind() {
    return eventKind;
  }

  public void setEventKind(String eventKind) {
    this.eventKind = eventKind;
  }

  public CommissionOutboxStatus getStatus() {
    return status;
  }

  public void setStatus(CommissionOutboxStatus status) {
    this.status = status;
  }

  public int getAttemptCount() {
    return attemptCount;
  }

  public void setAttemptCount(int attemptCount) {
    this.attemptCount = attemptCount;
  }

  public String getLastError() {
    return lastError;
  }

  public void setLastError(String lastError) {
    this.lastError = lastError;
  }

  public Instant getCreatedAt() {
    return createdAt;
  }

  public void setCreatedAt(Instant createdAt) {
    this.createdAt = createdAt;
  }

  public Instant getProcessedAt() {
    return processedAt;
  }

  public void setProcessedAt(Instant processedAt) {
    this.processedAt = processedAt;
  }
}
