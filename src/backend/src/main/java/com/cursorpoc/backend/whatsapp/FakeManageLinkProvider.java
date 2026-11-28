package com.cursorpoc.backend.whatsapp;

import java.util.Optional;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * e2e/test provider (provider {@code fake}): a made-up link, which the support controller can take
 * away.
 */
@Component
@ConditionalOnProperty(
    name = "app.femme.whatsapp.provider",
    havingValue = WhatsAppSettings.PROVIDER_FAKE)
public class FakeManageLinkProvider implements ManageLinkProvider {

  private volatile boolean available = true;

  @Override
  public Optional<String> linkSuffix(long tenantId, long appointmentId) {
    return available ? Optional.of("bella/turno/t" + appointmentId) : Optional.empty();
  }

  public void setAvailable(boolean available) {
    this.available = available;
  }
}
