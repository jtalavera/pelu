package com.cursorpoc.backend.whatsapp;

import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.TextStyle;
import java.util.Locale;

/**
 * How the date and time of a turno read inside a template variable (always Spanish, salon zone).
 */
public final class BookingNoticeFormatter {

  private static final Locale ES = Locale.forLanguageTag("es-PY");

  private BookingNoticeFormatter() {}

  /** {@code viernes 28/11}. */
  public static String date(Instant startAt, ZoneId zone) {
    ZonedDateTime z = startAt.atZone(zone);
    return String.format(
        "%s %02d/%02d",
        z.getDayOfWeek().getDisplayName(TextStyle.FULL, ES), z.getDayOfMonth(), z.getMonthValue());
  }

  /** {@code 15:30}. */
  public static String time(Instant startAt, ZoneId zone) {
    ZonedDateTime z = startAt.atZone(zone);
    return String.format("%02d:%02d", z.getHour(), z.getMinute());
  }
}
