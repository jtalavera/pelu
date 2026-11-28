package com.cursorpoc.backend.whatsapp;

import java.time.Duration;
import java.util.List;

/**
 * The transport to WhatsApp. {@link MetaCloudWhatsAppGateway} talks to Meta's Cloud API; {@link
 * FakeWhatsAppGateway} keeps the messages in memory for e2e. Which one is active is the explicit
 * property {@code app.femme.whatsapp.provider} ({@code meta} or {@code fake}).
 */
public interface WhatsAppGateway {

  /** Sends a template message. Throws {@link WhatsAppSendException} on any failure. */
  WhatsAppSendResult send(WhatsAppOutboundMessage message, Duration timeout);

  /**
   * Sends a free-form message (HU-WAP-06 replies), valid only inside the 24 h window opened by the
   * client's own message. Throws {@link WhatsAppSendException} on any failure.
   */
  WhatsAppSendResult sendSession(WhatsAppSessionMessage message, Duration timeout);

  /** Lists the account's templates with their approval status. */
  List<WhatsAppRemoteTemplate> listTemplates();
}
