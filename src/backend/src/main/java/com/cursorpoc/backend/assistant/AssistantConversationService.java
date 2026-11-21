package com.cursorpoc.backend.assistant;

import com.cursorpoc.backend.assistant.AssistantModelClient.ChatTurn;
import com.cursorpoc.backend.assistant.AssistantModelClient.Usage;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.EnumSet;
import java.util.List;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Persistence of conversations and messages. A conversation belongs to ONE user of ONE tenant:
 * every lookup carries both, so a guessed id of someone else's chat is simply "not found".
 */
@Service
public class AssistantConversationService {

  /** How many messages the UI gets back when it reopens the panel. */
  static final int UI_HISTORY_LIMIT = 50;

  private static final EnumSet<AssistantMessageRole> CONVERSATIONAL =
      EnumSet.of(AssistantMessageRole.USER, AssistantMessageRole.ASSISTANT);

  private final AssistantConversationRepository conversations;
  private final AssistantMessageRepository messages;
  private final AssistantProperties properties;

  public AssistantConversationService(
      AssistantConversationRepository conversations,
      AssistantMessageRepository messages,
      AssistantProperties properties) {
    this.conversations = conversations;
    this.messages = messages;
    this.properties = properties;
  }

  /** The user's open conversation; created on first use. */
  @Transactional
  public AssistantConversation getOrCreateCurrent(long tenantId, long userId) {
    return conversations
        .findFirstByTenantIdAndUserIdAndClosedAtIsNullOrderByIdDesc(tenantId, userId)
        .orElseGet(() -> conversations.save(new AssistantConversation(tenantId, userId, now())));
  }

  /** Closes the open conversation (its history stays until retention) and opens a new one. */
  @Transactional
  public AssistantConversation startNew(long tenantId, long userId) {
    Instant now = now();
    conversations
        .findFirstByTenantIdAndUserIdAndClosedAtIsNullOrderByIdDesc(tenantId, userId)
        .ifPresent(c -> c.setClosedAt(now));
    return conversations.save(new AssistantConversation(tenantId, userId, now));
  }

  /** The caller's own, still-open conversation, or 404 {@code ASSISTANT_CONVERSATION_NOT_FOUND}. */
  @Transactional(readOnly = true)
  public AssistantConversation requireOpen(long conversationId, long tenantId, long userId) {
    return conversations
        .findByIdAndTenantIdAndUserId(conversationId, tenantId, userId)
        .filter(c -> c.getClosedAt() == null)
        .orElseThrow(
            () ->
                new ResponseStatusException(
                    HttpStatus.NOT_FOUND, "ASSISTANT_CONVERSATION_NOT_FOUND"));
  }

  @Transactional
  public AssistantMessage appendUser(long conversationId, String text, String inputMode) {
    AssistantMessage m =
        new AssistantMessage(conversationId, AssistantMessageRole.USER, text, now());
    m.setInputMode("VOICE".equals(inputMode) ? "VOICE" : "TEXT");
    return save(m);
  }

  @Transactional
  public AssistantMessage appendAssistant(long conversationId, String text, Usage usage) {
    AssistantMessage m =
        new AssistantMessage(conversationId, AssistantMessageRole.ASSISTANT, text, now());
    m.setPromptTokens(usage.promptTokens());
    m.setCompletionTokens(usage.completionTokens());
    return save(m);
  }

  @Transactional
  public AssistantMessage appendTool(long conversationId, String toolName, String resultJson) {
    AssistantMessage m =
        new AssistantMessage(conversationId, AssistantMessageRole.TOOL, resultJson, now());
    m.setToolName(toolName);
    return save(m);
  }

  /** Oldest first: the last {@code limit} user/assistant messages. */
  @Transactional(readOnly = true)
  public List<AssistantMessage> recentMessages(long conversationId, int limit) {
    List<AssistantMessage> newestFirst =
        new ArrayList<>(
            messages.findByConversationIdAndRoleInOrderByIdDesc(
                conversationId, CONVERSATIONAL, PageRequest.of(0, Math.max(1, limit))));
    Collections.reverse(newestFirst);
    return newestFirst;
  }

  /** The model's context: trimmed to {@code historyMaxMessages}; tool results are not replayed. */
  @Transactional(readOnly = true)
  public List<ChatTurn> contextTurns(long conversationId) {
    return recentMessages(conversationId, properties.getHistoryMaxMessages()).stream()
        .map(
            m ->
                m.getRole() == AssistantMessageRole.USER
                    ? ChatTurn.user(m.getContent())
                    : ChatTurn.assistant(m.getContent()))
        .toList();
  }

  @Transactional(readOnly = true)
  public ConversationView view(AssistantConversation c) {
    List<MessageView> rows =
        recentMessages(c.getId(), UI_HISTORY_LIMIT).stream()
            .map(
                m ->
                    new MessageView(
                        m.getId(),
                        m.getRole().name(),
                        m.getContent(),
                        m.getInputMode(),
                        m.getCreatedAt().toString()))
            .toList();
    return new ConversationView(c.getId(), rows);
  }

  /** Retention: drops every conversation (and its messages) idle since before {@code cutoff}. */
  @Transactional
  public int deleteInactiveSince(Instant cutoff) {
    List<Long> ids = conversations.findIdsInactiveSince(cutoff);
    if (ids.isEmpty()) {
      return 0;
    }
    messages.deleteByConversationIds(ids);
    conversations.deleteAllByIdInBatch(ids);
    return ids.size();
  }

  public Duration retention() {
    return Duration.ofDays(properties.getConversationRetentionDays());
  }

  private AssistantMessage save(AssistantMessage m) {
    AssistantMessage saved = messages.save(m);
    conversations
        .findById(m.getConversationId())
        .ifPresent(c -> c.setLastActivity(saved.getCreatedAt()));
    return saved;
  }

  private static Instant now() {
    return Instant.now();
  }

  public record ConversationView(long conversationId, List<MessageView> messages) {}

  public record MessageView(
      long id, String role, String content, String inputMode, String createdAt) {}
}
