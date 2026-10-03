package com.cursorpoc.backend.domain;

import com.cursorpoc.backend.domain.enums.StockEventType;
import com.cursorpoc.backend.domain.enums.StockOutboxStatus;
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

/**
 * Stock integration (HU-60): one event waiting to be (or already) delivered to control-stock.
 * Written in the same transaction as the business change that produced it (invoice, void, catalog
 * edit…), then delivered by {@code StockOutboxProcessor} — the database row, not the Service Bus
 * message, is the source of truth.
 */
@Entity
@Table(name = "stock_outbox")
public class StockOutboxEvent {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "tenant_id", nullable = false)
  private Long tenantId;

  @Enumerated(EnumType.STRING)
  @Column(name = "event_type", nullable = false, length = 32)
  private StockEventType eventType;

  /** e.g. {@code INVOICE:123} or {@code SERVICE:45} — lets the outbox answer "was it sold?". */
  @Column(name = "source_ref", length = 128)
  private String sourceRef;

  @Column(name = "payload_json", nullable = false, columnDefinition = "NVARCHAR(MAX)")
  private String payloadJson;

  @Column(name = "idempotency_key", nullable = false, length = 200, unique = true)
  private String idempotencyKey;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false, length = 16)
  private StockOutboxStatus status;

  @Column(name = "attempt_count", nullable = false)
  private int attemptCount;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "next_attempt_at")
  private Instant nextAttemptAt;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "processing_started_at")
  private Instant processingStartedAt;

  @Column(name = "last_error", length = 2000)
  private String lastError;

  @Column(name = "response_json", columnDefinition = "NVARCHAR(MAX)")
  private String responseJson;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "done_at")
  private Instant doneAt;

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

  public StockEventType getEventType() {
    return eventType;
  }

  public void setEventType(StockEventType eventType) {
    this.eventType = eventType;
  }

  public String getSourceRef() {
    return sourceRef;
  }

  public void setSourceRef(String sourceRef) {
    this.sourceRef = sourceRef;
  }

  public String getPayloadJson() {
    return payloadJson;
  }

  public void setPayloadJson(String payloadJson) {
    this.payloadJson = payloadJson;
  }

  public String getIdempotencyKey() {
    return idempotencyKey;
  }

  public void setIdempotencyKey(String idempotencyKey) {
    this.idempotencyKey = idempotencyKey;
  }

  public StockOutboxStatus getStatus() {
    return status;
  }

  public void setStatus(StockOutboxStatus status) {
    this.status = status;
  }

  public int getAttemptCount() {
    return attemptCount;
  }

  public void setAttemptCount(int attemptCount) {
    this.attemptCount = attemptCount;
  }

  public Instant getNextAttemptAt() {
    return nextAttemptAt;
  }

  public void setNextAttemptAt(Instant nextAttemptAt) {
    this.nextAttemptAt = nextAttemptAt;
  }

  public Instant getProcessingStartedAt() {
    return processingStartedAt;
  }

  public void setProcessingStartedAt(Instant processingStartedAt) {
    this.processingStartedAt = processingStartedAt;
  }

  public String getLastError() {
    return lastError;
  }

  public void setLastError(String lastError) {
    this.lastError = lastError;
  }

  public String getResponseJson() {
    return responseJson;
  }

  public void setResponseJson(String responseJson) {
    this.responseJson = responseJson;
  }

  public Instant getCreatedAt() {
    return createdAt;
  }

  public void setCreatedAt(Instant createdAt) {
    this.createdAt = createdAt;
  }

  public Instant getDoneAt() {
    return doneAt;
  }

  public void setDoneAt(Instant doneAt) {
    this.doneAt = doneAt;
  }
}
