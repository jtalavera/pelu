package com.cursorpoc.backend.booking;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/** RSV-02 criterio 2: the salon's address is 3–40 characters of [a-z0-9-], never a route word. */
class BookingSlugTest {

  @ParameterizedTest
  @ValueSource(strings = {"bella", "salon-bella-123", "abc", "a1b", "Bella", "  bella  "})
  void validSlugsAreNormalized(String raw) {
    assertThat(BookingSlug.normalize(raw)).hasValue(raw.trim().toLowerCase());
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "",
        " ",
        "ab",
        "-bella",
        "bella-",
        "be--lla",
        "bella_salon",
        "bella salon",
        "bélla",
        "bella.com",
        "bella/x",
        "ADMIN",
        "api",
        "login",
        "r",
        "app",
        "platform"
      })
  void invalidOrReservedSlugsAreRejected(String raw) {
    assertThat(BookingSlug.normalize(raw)).isEmpty();
  }

  @Test
  void lengthBoundaries() {
    assertThat(BookingSlug.normalize("a".repeat(40))).isPresent();
    assertThat(BookingSlug.normalize("a".repeat(41))).isEmpty();
    assertThat(BookingSlug.normalize("abc")).isPresent();
    assertThat(BookingSlug.normalize("ab")).isEmpty();
    assertThat(BookingSlug.normalize(null)).isEmpty();
  }
}
