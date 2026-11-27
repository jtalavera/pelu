package com.cursorpoc.backend.whatsapp;

/**
 * A dynamic button parameter of a template. {@code URL}: {@code value} is the variable part of the
 * button's URL (the template fixes the beginning). {@code QUICK_REPLY}: {@code value} is the
 * payload that comes back when the client taps it (HU-WAP-06 signs it). {@code index} is the
 * button's position in the template, starting at 0.
 */
public record WhatsAppButton(Kind kind, int index, String value) {

  public enum Kind {
    URL,
    QUICK_REPLY
  }

  public static WhatsAppButton url(int index, String urlSuffix) {
    return new WhatsAppButton(Kind.URL, index, urlSuffix);
  }

  public static WhatsAppButton quickReply(int index, String payload) {
    return new WhatsAppButton(Kind.QUICK_REPLY, index, payload);
  }
}
