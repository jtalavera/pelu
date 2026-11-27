package com.cursorpoc.backend.util;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;

class PhoneNumberNormalizerTest {

  @ParameterizedTest
  @ValueSource(
      strings = {
        "0981123456",
        "981123456",
        "+595981123456",
        "595981123456",
        "0981 123 456",
        "(0981) 123-456",
        "+595 981 123 456",
        "00595981123456",
        "  0981.123.456  "
      })
  void paraguayanMobile_isNormalized(String raw) {
    assertThat(PhoneNumberNormalizer.normalize(raw)).contains("+595981123456");
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "021123456", // landline
        "0211234567", // landline with wrong length for a mobile
        "+595211234567",
        "09811234", // too short
        "09811234567", // too long
        "98112345", // 8 digits
        "9811234567", // 10 digits without the 0
        "+5959811234", // international but short
        "abc",
        "0981-abc-456",
        "+",
        "098+1123456",
        "++595981123456"
      })
  void invalidInputs_areRejected(String raw) {
    assertThat(PhoneNumberNormalizer.normalize(raw)).isEmpty();
  }

  @ParameterizedTest
  @NullAndEmptySource
  @ValueSource(strings = {"   ", "\t"})
  void blank_isRejected(String raw) {
    assertThat(PhoneNumberNormalizer.normalize(raw)).isEmpty();
  }

  @Test
  void otherCountries_needThePlusPrefix() {
    assertThat(PhoneNumberNormalizer.normalize("+54 9 11 1234-5678")).contains("+5491112345678");
    assertThat(PhoneNumberNormalizer.normalize("005491112345678")).contains("+5491112345678");
    assertThat(PhoneNumberNormalizer.normalize("5491112345678")).isEmpty();
    assertThat(PhoneNumberNormalizer.normalize("+0123456789")).isEmpty();
    assertThat(PhoneNumberNormalizer.normalize("+1234567")).isEmpty();
    assertThat(PhoneNumberNormalizer.normalize("+1234567890123456")).isEmpty();
  }

  @Test
  void mask_keepsPrefixAndLastThreeDigits() {
    assertThat(PhoneNumberNormalizer.mask("+595981123456")).isEqualTo("+595******456");
    assertThat(PhoneNumberNormalizer.mask("123")).isEqualTo("***");
    assertThat(PhoneNumberNormalizer.mask(null)).isEmpty();
  }
}
