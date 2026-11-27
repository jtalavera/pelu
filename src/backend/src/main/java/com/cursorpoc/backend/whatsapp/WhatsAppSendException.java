package com.cursorpoc.backend.whatsapp;

/**
 * A failed WhatsApp send. The message only carries the category (and Meta's numeric code when there
 * is one) — never Meta's free text and never the recipient or the template parameters (RT-13).
 */
public class WhatsAppSendException extends RuntimeException {

  private final WhatsAppErrorCode code;
  private final Integer metaCode;

  public WhatsAppSendException(WhatsAppErrorCode code, Integer metaCode) {
    super(code.name() + (metaCode == null ? "" : " (meta " + metaCode + ")"));
    this.code = code;
    this.metaCode = metaCode;
  }

  public WhatsAppSendException(WhatsAppErrorCode code, Integer metaCode, Throwable cause) {
    super(code.name() + (metaCode == null ? "" : " (meta " + metaCode + ")"), cause);
    this.code = code;
    this.metaCode = metaCode;
  }

  public WhatsAppSendException(WhatsAppErrorCode code) {
    this(code, null);
  }

  public WhatsAppErrorCode getCode() {
    return code;
  }

  public Integer getMetaCode() {
    return metaCode;
  }

  public boolean isRetryable() {
    return code.isRetryable();
  }
}
