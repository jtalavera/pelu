package com.cursorpoc.backend.whatsapp;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** The salon switches are born OFF (RSV-02, criterio 11) and can be overridden per salon. */
class PropertyBookingMessagingSettingsTest {

  @Test
  void everySwitchIsOffByDefault() {
    var s = new PropertyBookingMessagingSettings(false, false, false);
    assertThat(s.bookingNoticesEnabled(1)).isFalse();
    assertThat(s.remindersEnabled(1)).isFalse();
    assertThat(s.buttonRepliesEnabled(1)).isFalse();
  }

  @Test
  void overridesAreIndependentAndPerSalon() {
    var s = new PropertyBookingMessagingSettings(false, false, false);
    s.overrideButtonReplies(1, true);
    assertThat(s.buttonRepliesEnabled(1)).isTrue();
    assertThat(s.buttonRepliesEnabled(2)).isFalse();
    assertThat(s.remindersEnabled(1)).isFalse();
    s.clearOverrides();
    assertThat(s.buttonRepliesEnabled(1)).isFalse();
  }
}
