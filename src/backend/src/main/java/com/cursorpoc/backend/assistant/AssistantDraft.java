package com.cursorpoc.backend.assistant;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * A proposal made in the chat (an invoice or an appointment) that exists ONLY here until a person
 * confirms it with the card's button. Nothing is written to the business tables before that. The
 * {@code payload} is validated JSON ({@link AssistantDraftPayloads}); {@code payloadHash} is a
 * fingerprint of what the draft was priced/scheduled against, compared again on confirmation.
 */
@Entity
@Table(name = "assistant_draft")
public class AssistantDraft {

  @Id
  @Column(name = "id", nullable = false)
  private UUID id;

  @Column(name = "tenant_id", nullable = false)
  private Long tenantId;

  @Column(name = "user_id", nullable = false)
  private Long userId;

  @Column(name = "conversation_id", nullable = false)
  private Long conversationId;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false, length = 16)
  private AssistantDraftType type;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false, length = 16)
  private AssistantDraftStatus status;

  @Column(nullable = false, columnDefinition = "NVARCHAR(MAX)")
  private String payload;

  @JdbcTypeCode(SqlTypes.CHAR)
  @Column(name = "payload_hash", nullable = false, length = 64)
  private String payloadHash;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "expires_at", nullable = false)
  private Instant expiresAt;

  @Column(name = "result_type", length = 16)
  private String resultType;

  @Column(name = "result_id")
  private Long resultId;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "updated_at", nullable = false)
  private Instant updatedAt;

  protected AssistantDraft() {}

  public AssistantDraft(
      Long tenantId,
      Long userId,
      Long conversationId,
      AssistantDraftType type,
      String payload,
      String payloadHash,
      Instant now,
      Instant expiresAt) {
    this.id = UUID.randomUUID();
    this.tenantId = tenantId;
    this.userId = userId;
    this.conversationId = conversationId;
    this.type = type;
    this.status = AssistantDraftStatus.DRAFT;
    this.payload = payload;
    this.payloadHash = payloadHash;
    this.createdAt = now;
    this.updatedAt = now;
    this.expiresAt = expiresAt;
  }

  public UUID getId() {
    return id;
  }

  public Long getTenantId() {
    return tenantId;
  }

  public Long getUserId() {
    return userId;
  }

  public Long getConversationId() {
    return conversationId;
  }

  public AssistantDraftType getType() {
    return type;
  }

  public AssistantDraftStatus getStatus() {
    return status;
  }

  public void setStatus(AssistantDraftStatus status) {
    this.status = status;
  }

  public String getPayload() {
    return payload;
  }

  public void setPayload(String payload) {
    this.payload = payload;
  }

  public String getPayloadHash() {
    return payloadHash;
  }

  public void setPayloadHash(String payloadHash) {
    this.payloadHash = payloadHash;
  }

  public Instant getExpiresAt() {
    return expiresAt;
  }

  /** Only the e2e test-support endpoint moves the expiry (a draft lives 24 hours). */
  void setExpiresAt(Instant expiresAt) {
    this.expiresAt = expiresAt;
  }

  public String getResultType() {
    return resultType;
  }

  public Long getResultId() {
    return resultId;
  }

  public void setResult(String resultType, Long resultId) {
    this.resultType = resultType;
    this.resultId = resultId;
  }

  public Instant getCreatedAt() {
    return createdAt;
  }

  public Instant getUpdatedAt() {
    return updatedAt;
  }

  public void setUpdatedAt(Instant updatedAt) {
    this.updatedAt = updatedAt;
  }
}
