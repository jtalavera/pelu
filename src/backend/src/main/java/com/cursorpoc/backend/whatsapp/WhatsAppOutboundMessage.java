package com.cursorpoc.backend.whatsapp;

import java.util.List;

/** What the gateway sends: a template, its body variables in order and its dynamic buttons. */
public record WhatsAppOutboundMessage(
    String to,
    String templateName,
    String languageCode,
    List<String> bodyParameters,
    List<WhatsAppButton> buttons) {

  public WhatsAppOutboundMessage {
    bodyParameters = bodyParameters == null ? List.of() : List.copyOf(bodyParameters);
    buttons = buttons == null ? List.of() : List.copyOf(buttons);
  }
}
