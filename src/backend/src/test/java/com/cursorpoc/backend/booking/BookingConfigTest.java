package com.cursorpoc.backend.booking;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

/** RSV-02 criterio 14: without the link secret a salon cannot turn bookings on. */
class BookingConfigTest {

  @Test
  void aShortOrMissingSecretIsNotConfigured() {
    assertThat(new BookingConfig("", "https://app.test").isConfigured()).isFalse();
    assertThat(new BookingConfig("too-short", "https://app.test").isConfigured()).isFalse();
    assertThatThrownBy(() -> new BookingConfig("", "https://app.test").requireConfigured())
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("BOOKING_NOT_CONFIGURED");
  }

  @Test
  void aLongEnoughSecretIsConfigured() {
    BookingConfig config = new BookingConfig("x".repeat(32), "https://app.test");
    assertThat(config.isConfigured()).isTrue();
    assertThat(config.tokenSecret()).hasSize(32);
  }

  @Test
  void publicUrlHasNoDoubleSlash() {
    assertThat(new BookingConfig("", "https://app.test/").publicUrl("bella"))
        .isEqualTo("https://app.test/r/bella");
  }
}
