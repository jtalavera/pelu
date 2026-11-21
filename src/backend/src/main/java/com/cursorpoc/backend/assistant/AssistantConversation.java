package com.cursorpoc.backend.assistant;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** One chat of one user with the assistant. Always scoped by tenant AND user. */
@Entity
@Table(name = "assistant_conversation")
public class AssistantConversation {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "tenant_id", nullable = false)
  private Long tenantId;

  @Column(name = "user_id", nullable = false)
  private Long userId;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "last_activity", nullable = false)
  private Instant lastActivity;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "closed_at")
  private Instant closedAt;

  protected AssistantConversation() {}

  public AssistantConversation(Long tenantId, Long userId, Instant now) {
    this.tenantId = tenantId;
    this.userId = userId;
    this.createdAt = now;
    this.lastActivity = now;
  }

  public Long getId() {
    return id;
  }

  public Long getTenantId() {
    return tenantId;
  }

  public Long getUserId() {
    return userId;
  }

  public Instant getCreatedAt() {
    return createdAt;
  }

  public Instant getLastActivity() {
    return lastActivity;
  }

  public void setLastActivity(Instant lastActivity) {
    this.lastActivity = lastActivity;
  }

  public Instant getClosedAt() {
    return closedAt;
  }

  public void setClosedAt(Instant closedAt) {
    this.closedAt = closedAt;
  }
}
