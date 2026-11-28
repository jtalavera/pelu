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
  private final boolean remindersDefaultEnabled;
  private final Map<Long, Boolean> overrides = new ConcurrentHashMap<>();
  private final Map<Long, Boolean> reminderOverrides = new ConcurrentHashMap<>();

  public PropertyBookingMessagingSettings(
      @Value("${app.femme.whatsapp.booking-notices-enabled:false}") boolean defaultEnabled,
      @Value("${app.femme.whatsapp.reminders-enabled:false}") boolean remindersDefaultEnabled) {
    this.defaultEnabled = defaultEnabled;
    this.remindersDefaultEnabled = remindersDefaultEnabled;
  }

  @Override
  public boolean bookingNoticesEnabled(long tenantId) {
    return overrides.getOrDefault(tenantId, defaultEnabled);
  }

  @Override
  public boolean remindersEnabled(long tenantId) {
    return reminderOverrides.getOrDefault(tenantId, remindersDefaultEnabled);
  }

  /** Test hook: {@code null} removes the override. */
  public void override(long tenantId, Boolean enabled) {
    if (enabled == null) {
      overrides.remove(tenantId);
    } else {
      overrides.put(tenantId, enabled);
    }
  }

  /** Test hook for the reminders switch: {@code null} removes the override. */
  public void overrideReminders(long tenantId, Boolean enabled) {
    if (enabled == null) {
      reminderOverrides.remove(tenantId);
    } else {
      reminderOverrides.put(tenantId, enabled);
    }
  }

  /** Test hook: back to the platform defaults for every salon. */
  public void clearOverrides() {
    overrides.clear();
    reminderOverrides.clear();
  }
}
