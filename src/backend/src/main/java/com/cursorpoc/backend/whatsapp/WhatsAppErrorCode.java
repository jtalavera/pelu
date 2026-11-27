package com.cursorpoc.backend.whatsapp;

/**
 * HU-WAP-01 (criterio 2): typed failure categories of a send. Each one says whether trying again
 * can help (HU-WAP-07 uses it from C1 on). The name doubles as the SCREAMING_SNAKE_CASE API error
 * code ({@code WHATSAPP_<NAME>}) the frontend translates.
 */
public enum WhatsAppErrorCode {
  /** The number is invalid or has no WhatsApp. */
  INVALID_RECIPIENT(false),
  /** The template does not exist, is not approved, or is paused/disabled. */
  TEMPLATE_UNAVAILABLE(false),
  /** Sending limit or quality limit reached. Can work again later. */
  RATE_LIMITED(true),
  /** Expired token or missing permissions. */
  AUTH_FAILED(false),
  /** Network failure, timeout or a temporary error at Meta. */
  TRANSIENT(true),
  /** The channel is switched off, not configured, or the salon's flags are off. */
  CHANNEL_UNAVAILABLE(false),
  /** The request itself is wrong (variable count, format). A bug on our side. */
  INVALID_REQUEST(false);

  private final boolean retryable;

  WhatsAppErrorCode(boolean retryable) {
    this.retryable = retryable;
  }

  public boolean isRetryable() {
    return retryable;
  }

  public String apiError() {
    return "WHATSAPP_" + name();
  }
}
