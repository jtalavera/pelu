package com.cursorpoc.backend.assistant;

import java.util.List;
import tools.jackson.databind.JsonNode;

/**
 * A draft as the card needs it. {@code payload} is the stored structure (see {@link
 * AssistantDraftPayloads}); {@code missing} lists what the person still has to complete before the
 * «Confirmar» button works ({@code PAYMENT_METHOD}, {@code CARD_BRAND}, {@code EMAIL}). {@code
 * messageId} is only set when the conversation is reloaded: the assistant message the card belongs
 * to.
 */
public record AssistantDraftDto(
    String id,
    String type,
    String status,
    String createdAt,
    String expiresAt,
    List<String> missing,
    JsonNode payload,
    String resultType,
    Long resultId,
    Long messageId) {

  /** The state the person will see: a refused confirmation rolls back to DRAFT. */
  public AssistantDraftDto withStatus(String newStatus) {
    return new AssistantDraftDto(
        id,
        type,
        newStatus,
        createdAt,
        expiresAt,
        missing,
        payload,
        resultType,
        resultId,
        messageId);
  }

  public AssistantDraftDto withMessageId(Long newMessageId) {
    return new AssistantDraftDto(
        id,
        type,
        status,
        createdAt,
        expiresAt,
        missing,
        payload,
        resultType,
        resultId,
        newMessageId);
  }
}
