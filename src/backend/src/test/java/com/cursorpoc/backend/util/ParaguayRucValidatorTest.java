package com.cursorpoc.backend.util;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class ParaguayRucValidatorTest {

  @Test
  void validSample_knownCheckDigit() {
    assertThat(ParaguayRucValidator.isValid("80000005-6")).isTrue();
  }

  @Test
  void invalidCheckDigit_rejected() {
    assertThat(ParaguayRucValidator.isValid("80000005-5")).isFalse();
  }

  @Test
  void invalidFormat_rejected() {
    assertThat(ParaguayRucValidator.isValid("80000005")).isFalse();
    assertThat(ParaguayRucValidator.isValid(null)).isFalse();
    assertThat(ParaguayRucValidator.isValid("")).isFalse();
  }

  @Test
  void computeVerificationDigit_matchesValidator() {
    int dv = ParaguayRucValidator.computeVerificationDigit("80000005");
    assertThat(dv).isEqualTo(6);
  }
}
