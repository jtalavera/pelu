package com.cursorpoc.backend.whatsapp;

/**
 * The email that replaces a WhatsApp notice that could not be delivered (HU-WAP-07). In production
 * it is the platform's email service; in e2e it is an in-memory recorder (like the fake gateway) so
 * a spec can see what would have been emailed.
 */
public interface FallbackEmailSender {

  /** Sends a plain-text email. Throws on failure (the caller releases its claim to retry). */
  void send(String toEmail, String subject, String body);
}
