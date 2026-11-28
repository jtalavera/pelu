package com.cursorpoc.backend.whatsapp;

import java.util.List;

/**
 * A free-form message, allowed only inside the 24 h window a client's own message opens
 * (HU-WAP-06). Plain text, or text with up to three reply buttons ({@code id} comes back when
 * tapped).
 */
public record WhatsAppSessionMessage(String to, String text, List<ReplyButton> buttons) {

  /** {@code title}: at most 20 characters (Meta's limit). */
  public record ReplyButton(String id, String title) {}

  public WhatsAppSessionMessage {
    buttons = buttons == null ? List.of() : List.copyOf(buttons);
  }

  public static WhatsAppSessionMessage text(String to, String text) {
    return new WhatsAppSessionMessage(to, text, List.of());
  }
}
