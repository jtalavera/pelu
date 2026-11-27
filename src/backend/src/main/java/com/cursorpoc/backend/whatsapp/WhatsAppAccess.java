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

  /** Both flags on for the salon (no platform switch): what the consent UI and API need. */
  public boolean areFlagsOn(long tenantId) {
    return featureFlagService.isEnabled(FLAG, tenantId)
        && featureFlagService.isEnabled(BOOKING_FLAG, tenantId);
  }

  /** RT-01: authenticated calls of the channel answer {@code 403 <FLAG>_DISABLED} when off. */
  public void requireFlags(long tenantId) {
    if (!featureFlagService.isEnabled(FLAG, tenantId)) {
      throw new org.springframework.web.server.ResponseStatusException(
          org.springframework.http.HttpStatus.FORBIDDEN, FLAG + "_DISABLED");
    }
    if (!featureFlagService.isEnabled(BOOKING_FLAG, tenantId)) {
      throw new org.springframework.web.server.ResponseStatusException(
          org.springframework.http.HttpStatus.FORBIDDEN, BOOKING_FLAG + "_DISABLED");
    }
  }

  public void requireAvailable(long tenantId) {
    if (!isChannelAvailable(tenantId)) {
      throw new WhatsAppSendException(WhatsAppErrorCode.CHANNEL_UNAVAILABLE);
    }
  }
}
