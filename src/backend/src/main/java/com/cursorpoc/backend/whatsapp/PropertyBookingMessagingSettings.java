package com.cursorpoc.backend.whatsapp;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Stand-in until the booking settings exist (A2): one platform-wide default ({@code
 * app.femme.whatsapp.booking-notices-enabled}, OFF), plus an in-memory per-salon override that only
 * the e2e support controller sets. Nothing here is persisted.
 */
@Component
public class PropertyBookingMessagingSettings implements BookingMessagingSettings {

  private final boolean defaultEnabled;
  private final Map<Long, Boolean> overrides = new ConcurrentHashMap<>();

  public PropertyBookingMessagingSettings(
      @Value("${app.femme.whatsapp.booking-notices-enabled:false}") boolean defaultEnabled) {
    this.defaultEnabled = defaultEnabled;
  }

  @Override
  public boolean bookingNoticesEnabled(long tenantId) {
    return overrides.getOrDefault(tenantId, defaultEnabled);
  }

  /** Test hook: {@code null} removes the override. */
  public void override(long tenantId, Boolean enabled) {
    if (enabled == null) {
      overrides.remove(tenantId);
    } else {
      overrides.put(tenantId, enabled);
    }
  }
}
