package com.cursorpoc.backend.whatsapp;

import com.cursorpoc.backend.service.FeatureFlagService;
import org.springframework.stereotype.Component;

/**
 * HU-WAP-01 (criterio 8): the channel works for a salon only with {@code WHATSAPP_REMINDERS} AND
 * {@code ONLINE_BOOKING} on for it, AND the platform switch on with a complete configuration.
 * Anything else means "channel unavailable"; whoever asked falls back to email.
 */
@Component
public class WhatsAppAccess {

  public static final String FLAG = "WHATSAPP_REMINDERS";
  public static final String BOOKING_FLAG = "ONLINE_BOOKING";

  private final FeatureFlagService featureFlagService;
  private final WhatsAppSettings settings;

  public WhatsAppAccess(FeatureFlagService featureFlagService, WhatsAppSettings settings) {
    this.featureFlagService = featureFlagService;
    this.settings = settings;
  }

  public boolean isChannelAvailable(long tenantId) {
    return settings.isOperational()
        && featureFlagService.isEnabled(FLAG, tenantId)
        && featureFlagService.isEnabled(BOOKING_FLAG, tenantId);
  }

  public void requireAvailable(long tenantId) {
    if (!isChannelAvailable(tenantId)) {
      throw new WhatsAppSendException(WhatsAppErrorCode.CHANNEL_UNAVAILABLE);
    }
  }
}
