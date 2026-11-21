package com.cursorpoc.backend.assistant;

import java.util.Map;
import org.springframework.http.HttpStatus;

/**
 * A draft operation refused with a translatable code, optionally with a body the card needs to
 * recover (the recalculated draft after {@code ASSISTANT_PRICE_CHANGED}, the original result after
 * {@code ASSISTANT_DRAFT_ALREADY_CONFIRMED}, alternative times after {@code ASSISTANT_SLOT_TAKEN}).
 */
public class AssistantDraftException extends RuntimeException {

  private final HttpStatus status;
  private final String code;
  private final transient Map<String, Object> extra;

  public AssistantDraftException(HttpStatus status, String code) {
    this(status, code, Map.of());
  }

  public AssistantDraftException(HttpStatus status, String code, Map<String, Object> extra) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }

  public HttpStatus status() {
    return status;
  }

  public String code() {
    return code;
  }

  public Map<String, Object> extra() {
    return extra;
  }
}
