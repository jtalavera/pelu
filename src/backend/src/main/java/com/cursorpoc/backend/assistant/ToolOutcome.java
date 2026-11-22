package com.cursorpoc.backend.assistant;

import java.util.List;

/**
 * What running a tool yields: the JSON the model reads, plus cards for the person — SSE events
 * ({@code card.draft}, {@code card.draft.updated}, {@code card.options}) sent after the tool is
 * done. The model never writes a card: they come from backend data.
 */
record ToolOutcome(String json, List<CardEvent> cards) {

  record CardEvent(String event, Object payload) {}

  static ToolOutcome of(String json) {
    return new ToolOutcome(json, List.of());
  }
}
