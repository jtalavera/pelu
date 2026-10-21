package com.cursorpoc.backend.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import org.junit.jupiter.api.Test;

/** HU-69 — birthday rules. */
class ClientBirthdayTest {

  private static final LocalDate TODAY = LocalDate.of(2026, 10, 21);

  @Test
  void validation() {
    assertThat(ClientBirthday.isValid(null, null, null, TODAY)).isTrue();
    assertThat(ClientBirthday.isValid(15, 8, null, TODAY)).isTrue();
    assertThat(ClientBirthday.isValid(15, 8, 1990, TODAY)).isTrue();
    assertThat(ClientBirthday.isValid(29, 2, null, TODAY)).isTrue();
    assertThat(ClientBirthday.isValid(29, 2, 2000, TODAY)).isTrue();
    // Day and month go together; a year alone is meaningless.
    assertThat(ClientBirthday.isValid(15, null, null, TODAY)).isFalse();
    assertThat(ClientBirthday.isValid(null, 8, null, TODAY)).isFalse();
    assertThat(ClientBirthday.isValid(null, null, 1990, TODAY)).isFalse();
    // Dates that don't exist.
    assertThat(ClientBirthday.isValid(31, 4, null, TODAY)).isFalse();
    assertThat(ClientBirthday.isValid(30, 2, null, TODAY)).isFalse();
    assertThat(ClientBirthday.isValid(29, 2, 2001, TODAY)).isFalse();
    assertThat(ClientBirthday.isValid(0, 1, null, TODAY)).isFalse();
    assertThat(ClientBirthday.isValid(1, 13, null, TODAY)).isFalse();
    // Future dates / absurd years.
    assertThat(ClientBirthday.isValid(1, 1, 2027, TODAY)).isFalse();
    assertThat(ClientBirthday.isValid(22, 10, 2026, TODAY)).isFalse();
    assertThat(ClientBirthday.isValid(1, 1, 1899, TODAY)).isFalse();
  }

  @Test
  void leapDayIsCelebratedOnFeb28InCommonYears() {
    assertThat(ClientBirthday.isBirthdayOn(29, 2, LocalDate.of(2027, 2, 28))).isTrue();
    assertThat(ClientBirthday.isBirthdayOn(29, 2, LocalDate.of(2028, 2, 28))).isFalse();
    assertThat(ClientBirthday.isBirthdayOn(29, 2, LocalDate.of(2028, 2, 29))).isTrue();
  }

  @Test
  void nextOccurrenceRollsOverToNextYear() {
    assertThat(ClientBirthday.nextOccurrence(21, 10, TODAY)).isEqualTo(TODAY);
    assertThat(ClientBirthday.nextOccurrence(20, 10, TODAY)).isEqualTo(LocalDate.of(2027, 10, 20));
    assertThat(ClientBirthday.nextOccurrence(2, 1, LocalDate.of(2026, 12, 30)))
        .isEqualTo(LocalDate.of(2027, 1, 2));
  }
}
