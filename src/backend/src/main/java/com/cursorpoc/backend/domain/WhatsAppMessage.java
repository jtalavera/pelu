package com.cursorpoc.backend.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

/**
 * HU-WAP-01/07: outbox and delivery log of the WhatsApp channel. One row per message, unique per
 * (tenant, dedupKey) so retries, double clicks or repeated approvals never send twice.
 */
@Entity
@Table(name = "whatsapp_messages")
public class WhatsAppMessage {

  public static final String QUEUED = "QUEUED";
  public static final String SENDING = "SENDING";
  public static final String SENT = "SENT";
  public static final String DELIVERED = "DELIVERED";
  public static final String READ = "READ";
  public static final String FAILED = "FAILED";
  public static final String CANCELLED = "CANCELLED";

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "tenant_id", nullable = false)
  private Long tenantId;

  @Column(name = "appointment_id")
  private Long appointmentId;

  @Column(name = "client_id")
  private Long clientId;

  @Column(nullable = false, length = 32)
  private String purpose;

  @Column(nullable = false, length = 64)
  private String template;

  @Column(nullable = false, length = 32)
  private String recipient;

  @Column(nullable = false, columnDefinition = "NVARCHAR(MAX)")
  private String payload;

  @Column(name = "dedup_key", nullable = false, length = 200)
  private String dedupKey;

  @Column(nullable = false, length = 16)
  private String status;

  @Column(name = "meta_message_id", length = 200)
  private String metaMessageId;

  @Column(name = "error_code", length = 64)
  private String errorCode;

  @Column(nullable = false)
  private int attempts;

  @Column(name = "next_attempt_at")
  private Instant nextAttemptAt;

  @Column(name = "fallback_email_sent_at")
  private Instant fallbackEmailSentAt;

  @Column(name = "queued_at", nullable = false)
  private Instant queuedAt;

  @Column(name = "sent_at")
  private Instant sentAt;

  @Column(name = "delivered_at")
  private Instant deliveredAt;

  @Column(name = "read_at")
  private Instant readAt;

  @Column(name = "failed_at")
  private Instant failedAt;

  public Long getId() {
    return id;
  }

  public Long getTenantId() {
    return tenantId;
  }

  public void setTenantId(Long tenantId) {
    this.tenantId = tenantId;
  }

  public Long getAppointmentId() {
    return appointmentId;
  }

  public void setAppointmentId(Long appointmentId) {
    this.appointmentId = appointmentId;
  }

  public Long getClientId() {
    return clientId;
  }

  public void setClientId(Long clientId) {
    this.clientId = clientId;
  }

  public String getPurpose() {
    return purpose;
  }

  public void setPurpose(String purpose) {
    this.purpose = purpose;
  }

  public String getTemplate() {
    return template;
  }

  public void setTemplate(String template) {
    this.template = template;
  }

  public String getRecipient() {
    return recipient;
  }

  public void setRecipient(String recipient) {
    this.recipient = recipient;
  }

  public String getPayload() {
    return payload;
  }

  public void setPayload(String payload) {
    this.payload = payload;
  }

  public String getDedupKey() {
    return dedupKey;
  }

  public void setDedupKey(String dedupKey) {
    this.dedupKey = dedupKey;
  }

  public String getStatus() {
    return status;
  }

  public void setStatus(String status) {
    this.status = status;
  }

  public String getMetaMessageId() {
    return metaMessageId;
  }

  public void setMetaMessageId(String metaMessageId) {
    this.metaMessageId = metaMessageId;
  }

  public String getErrorCode() {
    return errorCode;
  }

  public void setErrorCode(String errorCode) {
    this.errorCode = errorCode;
  }

  public int getAttempts() {
    return attempts;
  }

  public void setAttempts(int attempts) {
    this.attempts = attempts;
  }

  public Instant getNextAttemptAt() {
    return nextAttemptAt;
  }

  public void setNextAttemptAt(Instant nextAttemptAt) {
    this.nextAttemptAt = nextAttemptAt;
  }

  public Instant getFallbackEmailSentAt() {
    return fallbackEmailSentAt;
  }

  public void setFallbackEmailSentAt(Instant fallbackEmailSentAt) {
    this.fallbackEmailSentAt = fallbackEmailSentAt;
  }

  public Instant getQueuedAt() {
    return queuedAt;
  }

  public void setQueuedAt(Instant queuedAt) {
    this.queuedAt = queuedAt;
  }

  public Instant getSentAt() {
    return sentAt;
  }

  public void setSentAt(Instant sentAt) {
    this.sentAt = sentAt;
  }

  public Instant getDeliveredAt() {
    return deliveredAt;
  }

  public void setDeliveredAt(Instant deliveredAt) {
    this.deliveredAt = deliveredAt;
  }

  public Instant getReadAt() {
    return readAt;
  }

  public void setReadAt(Instant readAt) {
    this.readAt = readAt;
  }

  public Instant getFailedAt() {
    return failedAt;
  }

  public void setFailedAt(Instant failedAt) {
    this.failedAt = failedAt;
  }
}
