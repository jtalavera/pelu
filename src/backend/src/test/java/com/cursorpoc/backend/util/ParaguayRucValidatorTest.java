package com.cursorpoc.backend.util;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class ParaguayRucValidatorTest {

  @Test
  void validFormat_accepted() {
    assertThat(ParaguayRucValidator.isValid("80000005-6")).isTrue();
    assertThat(ParaguayRucValidator.isValid("80000005-5")).isTrue();
    assertThat(ParaguayRucValidator.isValid("1-2")).isTrue();
  }

  @Test
  void invalidFormat_rejected() {
    assertThat(ParaguayRucValidator.isValid("80000005")).isFalse();
    assertThat(ParaguayRucValidator.isValid("abc-1")).isFalse();
    assertThat(ParaguayRucValidator.isValid("80000005-")).isFalse();
    assertThat(ParaguayRucValidator.isValid("-6")).isFalse();
    assertThat(ParaguayRucValidator.isValid(null)).isFalse();
    assertThat(ParaguayRucValidator.isValid("")).isFalse();
  }
}
