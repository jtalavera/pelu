package com.cursorpoc.backend.assistant;

/** Where the orchestrator writes the SSE events of one answer (an {@code SseEmitter} in prod). */
public interface AssistantEventSink {

  /**
   * @throws AssistantClientGoneException when the browser is no longer listening
   */
  void send(String event, Object payload);

  /** The client closed the stream (tab closed, request aborted): stop working for it. */
  class AssistantClientGoneException extends RuntimeException {
    public AssistantClientGoneException(Throwable cause) {
      super("assistant client disconnected", cause);
    }
  }
}
