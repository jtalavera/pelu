package com.cursorpoc.backend.assistant;

/** The model could not produce an answer (not configured, unreachable, rejected, timed out…). */
public class AssistantModelException extends RuntimeException {

  public AssistantModelException(String message, Throwable cause) {
    super(message, cause);
  }

  public AssistantModelException(String message) {
    super(message);
  }
}
