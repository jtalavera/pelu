package com.cursorpoc.backend.assistant;

import java.io.IOException;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import tools.jackson.databind.ObjectMapper;

/** Writes the orchestrator's events to the browser as Server-Sent Events. */
final class SseAssistantEventSink implements AssistantEventSink {

  private final SseEmitter emitter;
  private final ObjectMapper objectMapper;

  SseAssistantEventSink(SseEmitter emitter, ObjectMapper objectMapper) {
    this.emitter = emitter;
    this.objectMapper = objectMapper;
  }

  @Override
  public void send(String event, Object payload) {
    try {
      emitter.send(SseEmitter.event().name(event).data(objectMapper.writeValueAsString(payload)));
    } catch (IOException | IllegalStateException e) {
      throw new AssistantClientGoneException(e);
    }
  }
}
