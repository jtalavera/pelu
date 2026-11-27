package com.cursorpoc.backend.whatsapp;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.time.ZoneId;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

class BookingNoticeFormatterTest {

  private static final ZoneId ASUNCION = ZoneId.of("America/Asuncion");

  @Test
  void dateAndTime_areInTheSalonsZone_inSpanish() {
    Instant start = Instant.parse("2026-11-27T18:30:00Z"); // 15:30 in Asunción (UTC-3 in November)
    assertThat(BookingNoticeFormatter.date(start, ASUNCION)).isEqualTo("viernes 27/11");
    assertThat(BookingNoticeFormatter.time(start, ASUNCION)).isEqualTo("15:30");
  }

  @Test
  void aTurnoThatIsAnotherDayInUtc_usesTheSalonsDay() {
    Instant start = Instant.parse("2026-11-28T01:15:00Z"); // 22:15 of Friday in Asunción
    assertThat(BookingNoticeFormatter.date(start, ASUNCION)).isEqualTo("viernes 27/11");
    assertThat(BookingNoticeFormatter.time(start, ASUNCION)).isEqualTo("22:15");
    assertThat(BookingNoticeFormatter.date(start, ZoneId.of("UTC"))).isEqualTo("sábado 28/11");
  }

  @ParameterizedTest
  @CsvSource({
    "2026-11-23T15:00:00Z,lunes 23/11",
    "2026-11-24T15:00:00Z,martes 24/11",
    "2026-11-25T15:00:00Z,miércoles 25/11",
    "2026-11-26T15:00:00Z,jueves 26/11",
    "2026-11-27T15:00:00Z,viernes 27/11",
    "2026-11-28T15:00:00Z,sábado 28/11",
    "2026-11-29T15:00:00Z,domingo 29/11",
    "2026-01-05T15:00:00Z,lunes 05/01"
  })
  void weekdayNamesAreSpanish_andDayAndMonthHaveTwoDigits(String iso, String expected) {
    assertThat(BookingNoticeFormatter.date(Instant.parse(iso), ASUNCION)).isEqualTo(expected);
  }

  @Test
  void timeHasTwoDigits() {
    assertThat(BookingNoticeFormatter.time(Instant.parse("2026-11-27T12:05:00Z"), ASUNCION))
        .isEqualTo("09:05");
  }

  @Test
  void bothFitTheTemplateVariableRules() {
    String date = BookingNoticeFormatter.date(Instant.parse("2026-11-27T18:30:00Z"), ASUNCION);
    String time = BookingNoticeFormatter.time(Instant.parse("2026-11-27T18:30:00Z"), ASUNCION);
    assertThat(WhatsAppTemplateVariables.sanitize(date)).isEqualTo(date);
    assertThat(WhatsAppTemplateVariables.sanitize(time)).isEqualTo(time);
  }
}
