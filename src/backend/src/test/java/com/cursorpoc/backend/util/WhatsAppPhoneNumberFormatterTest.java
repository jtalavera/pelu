package com.cursorpoc.backend.util;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** Issue #225: local Paraguay client phone formats -> Meta WhatsApp Cloud API E.164 destination. */
class WhatsAppPhoneNumberFormatterTest {

  @Test
  void completeLocalFormat_isConvertedToE164WithParaguayCountryCode() {
    assertThat(WhatsAppPhoneNumberFormatter.toWhatsAppDestination("(0981) 123-456"))
        .isEqualTo("+595981123456");
  }

  @Test
  void completeLocalDigitsOnly_isConvertedToE164() {
    assertThat(WhatsAppPhoneNumberFormatter.toWhatsAppDestination("0981123456"))
        .isEqualTo("+595981123456");
  }

  @Test
  void alreadyHasCountryCode_isPassedThroughWithLeadingPlus() {
    assertThat(WhatsAppPhoneNumberFormatter.toWhatsAppDestination("595981123456"))
        .isEqualTo("+595981123456");
  }

  @Test
  void alreadyE164WithPlus_isNormalized() {
    assertThat(WhatsAppPhoneNumberFormatter.toWhatsAppDestination("+595 981 123 456"))
        .isEqualTo("+595981123456");
  }

  @Test
  void nullPhone_returnsNull() {
    assertThat(WhatsAppPhoneNumberFormatter.toWhatsAppDestination(null)).isNull();
  }

  @Test
  void blankPhone_returnsNull() {
    assertThat(WhatsAppPhoneNumberFormatter.toWhatsAppDestination("   ")).isNull();
  }

  @Test
  void incompleteLocalNumber_returnsNull() {
    assertThat(WhatsAppPhoneNumberFormatter.toWhatsAppDestination("0981123")).isNull();
  }

  @Test
  void localNumberMissingTrunkPrefix_returnsNull() {
    // 10 digits but doesn't start with the trunk "0" -- not a shape this app expects, so it's
    // rejected rather than guessed at.
    assertThat(WhatsAppPhoneNumberFormatter.toWhatsAppDestination("1981123456")).isNull();
  }

  @Test
  void nonNumericGarbage_returnsNull() {
    assertThat(WhatsAppPhoneNumberFormatter.toWhatsAppDestination("abc-def")).isNull();
  }
}
