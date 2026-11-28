package com.cursorpoc.backend.whatsapp;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalTime;
import java.time.ZoneId;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * HU-WAP-05 (criterio 5): no WhatsApp reminders between 21:00 and 08:00 (salon time, platform
 * setting). One that falls in that window goes out at 08:00 — the hourly job simply finds it again
 * — unless the turno starts in less than 12 hours, in which case it goes out anyway. Applies to the
 * WhatsApp channel only: the email reminder keeps its behaviour.
 */
@Component
public class ReminderQuietHours {

  private final LocalTime start;
  private final LocalTime end;
  private final Duration overrideWithin;

  public ReminderQuietHours(
      @Value("${app.femme.whatsapp.quiet-hours-start:21:00}") String start,
      @Value("${app.femme.whatsapp.quiet-hours-end:08:00}") String end,
      @Value("${app.femme.whatsapp.quiet-hours-override-hours:12}") int overrideHours) {
    this.start = LocalTime.parse(start);
    this.end = LocalTime.parse(end);
    this.overrideWithin = Duration.ofHours(overrideHours);
  }

  /** Whether {@code now} falls in the quiet window (which may cross midnight). */
  public boolean isQuiet(Instant now, ZoneId zone) {
    LocalTime t = now.atZone(zone).toLocalTime();
    if (start.isAfter(end)) {
      return !t.isBefore(start) || t.isBefore(end);
    }
    return !t.isBefore(start) && t.isBefore(end);
  }

  /** True when the reminder must wait for the end of the quiet hours. */
  public boolean defers(Instant now, Instant startAt, ZoneId zone) {
    return isQuiet(now, zone) && Duration.between(now, startAt).compareTo(overrideWithin) >= 0;
  }
}
