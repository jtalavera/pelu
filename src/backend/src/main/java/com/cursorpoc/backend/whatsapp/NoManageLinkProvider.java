package com.cursorpoc.backend.whatsapp;

import java.util.Optional;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/** Production default until the booking page exists (A0, A5): no link, so no WhatsApp reminder. */
@Component
@ConditionalOnProperty(
    name = "app.femme.whatsapp.provider",
    havingValue = WhatsAppSettings.PROVIDER_META,
    matchIfMissing = true)
public class NoManageLinkProvider implements ManageLinkProvider {

  @Override
  public Optional<String> linkSuffix(long tenantId, long appointmentId) {
    return Optional.empty();
  }
}
