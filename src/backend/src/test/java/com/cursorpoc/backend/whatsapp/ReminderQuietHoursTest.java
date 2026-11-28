package com.cursorpoc.backend.whatsapp;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.time.ZoneId;
import org.junit.jupiter.api.Test;

/** HU-WAP-05 criterio 5: 21:00–08:00 salon time, unless the turno is under 12 h away. */
class ReminderQuietHoursTest {

  private static final ZoneId ASU = ZoneId.of("America/Asuncion"); // UTC-3 in November
  private final ReminderQuietHours quiet = new ReminderQuietHours("21:00", "08:00", 12);

  private static Instant asu(String localDateTime) {
    return java.time.LocalDateTime.parse(localDateTime).atZone(ASU).toInstant();
  }

  @Test
  void windowCrossesMidnight() {
    assertThat(quiet.isQuiet(asu("2026-11-26T20:59:00"), ASU)).isFalse();
    assertThat(quiet.isQuiet(asu("2026-11-26T21:00:00"), ASU)).isTrue();
    assertThat(quiet.isQuiet(asu("2026-11-27T03:00:00"), ASU)).isTrue();
    assertThat(quiet.isQuiet(asu("2026-11-27T07:59:00"), ASU)).isTrue();
    assertThat(quiet.isQuiet(asu("2026-11-27T08:00:00"), ASU)).isFalse();
  }

  @Test
  void defersOnlyWhenTheTurnoIsTwelveHoursOrMoreAway() {
    Instant now = asu("2026-11-26T22:00:00");
    assertThat(quiet.defers(now, asu("2026-11-27T10:00:00"), ASU)).isTrue(); // 12 h exactly
    assertThat(quiet.defers(now, asu("2026-11-27T09:59:00"), ASU)).isFalse(); // < 12 h
    assertThat(quiet.defers(now, asu("2026-11-27T08:30:00"), ASU)).isFalse();
  }

  @Test
  void neverDefersOutsideTheQuietHours() {
    Instant now = asu("2026-11-26T15:00:00");
    assertThat(quiet.defers(now, asu("2026-11-28T15:00:00"), ASU)).isFalse();
  }
}
