package com.cursorpoc.backend.assistant;

/**
 * Issues the short-lived token the browser uses to talk to Azure AI Speech directly (dictation,
 * HU-AST-07). The browser never receives an Entra ID token nor a key: only a Speech-scoped token
 * that stops working minutes later.
 */
public interface SpeechTokenProvider {

  /**
   * @throws SpeechUnavailableException when Speech is not configured or Azure refuses/fails
   */
  SpeechToken issue();

  /**
   * @param token opaque token for {@code SpeechConfig.fromAuthorizationToken(token, region)}
   * @param region Azure region of the Speech resource
   * @param expiresInSeconds how long the browser may keep using it
   */
  record SpeechToken(String token, String region, int expiresInSeconds) {}

  /** Speech is not available right now; the card/panel shows a translated message. */
  class SpeechUnavailableException extends RuntimeException {
    public SpeechUnavailableException(String message) {
      super(message);
    }

    public SpeechUnavailableException(String message, Throwable cause) {
      super(message, cause);
    }
  }
}
