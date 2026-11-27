package com.cursorpoc.backend.whatsapp;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class WhatsAppSettingsTest {

  private static WhatsAppSettings settings(boolean enabled, String provider, String token) {
    return new WhatsAppSettings(
        enabled, provider, token, "pn", "waba", "secret", "verify", "v21.0", "http://x", 1, 1, 1);
  }

  @Test
  void disabled_isNeverOperational_andReportsNothingMissing() {
    WhatsAppSettings s = settings(false, "meta", "");
    assertThat(s.isOperational()).isFalse();
    assertThat(s.configurationProblems()).isEmpty();
  }

  @Test
  void enabledAndComplete_isOperational() {
    assertThat(settings(true, "meta", "tok").isOperational()).isTrue();
  }

  @Test
  void enabledWithAMissingValue_isOff_andNamesIt() {
    WhatsAppSettings s = settings(true, "meta", " ");
    assertThat(s.isOperational()).isFalse();
    assertThat(s.configurationProblems()).containsExactly("WHATSAPP_ACCESS_TOKEN");
  }

  @Test
  void theFakeProviderNeedsNoCredentials() {
    WhatsAppSettings s =
        new WhatsAppSettings(true, "fake", "", "", "", "", "", "v21.0", "", 1, 1, 1);
    assertThat(s.isOperational()).isTrue();
    assertThat(s.isFake()).isTrue();
  }

  @Test
  void anUnknownProvider_isReportedAndOff() {
    WhatsAppSettings s = settings(true, "twilio", "tok");
    assertThat(s.isOperational()).isFalse();
    assertThat(s.configurationProblems()).contains("provider");
  }
}
