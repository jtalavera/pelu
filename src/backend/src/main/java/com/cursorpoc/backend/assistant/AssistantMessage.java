package com.cursorpoc.backend.assistant;

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
 * A message of a conversation: what the user typed, what the assistant answered, or a tool result.
 */
@Entity
@Table(name = "assistant_message")
public class AssistantMessage {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "conversation_id", nullable = false)
  private Long conversationId;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false, length = 16)
  private AssistantMessageRole role;

  /** Text, or the JSON result of a tool call (role TOOL). */
  @Column(nullable = false, columnDefinition = "NVARCHAR(MAX)")
  private String content;

  /** {@code TEXT} or {@code VOICE} (user messages only). */
  @Column(name = "input_mode", length = 8)
  private String inputMode;

  @Column(name = "tool_name", length = 64)
  private String toolName;

  @Column(name = "prompt_tokens")
  private Integer promptTokens;

  @Column(name = "completion_tokens")
  private Integer completionTokens;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  protected AssistantMessage() {}

  public AssistantMessage(
      Long conversationId, AssistantMessageRole role, String content, Instant createdAt) {
    this.conversationId = conversationId;
    this.role = role;
    this.content = content;
    this.createdAt = createdAt;
  }

  public Long getId() {
    return id;
  }

  public Long getConversationId() {
    return conversationId;
  }

  public AssistantMessageRole getRole() {
    return role;
  }

  public String getContent() {
    return content;
  }

  public String getInputMode() {
    return inputMode;
  }

  public void setInputMode(String inputMode) {
    this.inputMode = inputMode;
  }

  public String getToolName() {
    return toolName;
  }

  public void setToolName(String toolName) {
    this.toolName = toolName;
  }

  public Integer getPromptTokens() {
    return promptTokens;
  }

  public void setPromptTokens(Integer promptTokens) {
    this.promptTokens = promptTokens;
  }

  public Integer getCompletionTokens() {
    return completionTokens;
  }

  public void setCompletionTokens(Integer completionTokens) {
    this.completionTokens = completionTokens;
  }

  public Instant getCreatedAt() {
    return createdAt;
  }
}
