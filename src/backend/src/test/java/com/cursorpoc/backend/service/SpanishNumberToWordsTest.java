package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.math.BigDecimal;
import org.junit.jupiter.api.Test;

/** Issue #55: unit tests for SpanishNumberToWords. */
class SpanishNumberToWordsTest {

  // ─── toWords ────────────────────────────────────────────────────────────────

  @Test
  void toWords_zero() {
    assertThat(SpanishNumberToWords.toWords(0)).isEqualTo("cero");
  }

  @Test
  void toWords_oneToTwenty() {
    assertThat(SpanishNumberToWords.toWords(1)).isEqualTo("uno");
    assertThat(SpanishNumberToWords.toWords(15)).isEqualTo("quince");
    assertThat(SpanishNumberToWords.toWords(20)).isEqualTo("veinte");
    assertThat(SpanishNumberToWords.toWords(21)).isEqualTo("veintiuno");
    assertThat(SpanishNumberToWords.toWords(29)).isEqualTo("veintinueve");
  }

  @Test
  void toWords_thirtyToNinetyNine() {
    assertThat(SpanishNumberToWords.toWords(30)).isEqualTo("treinta");
    assertThat(SpanishNumberToWords.toWords(31)).isEqualTo("treinta y uno");
    assertThat(SpanishNumberToWords.toWords(99)).isEqualTo("noventa y nueve");
  }

  @Test
  void toWords_exactlyOneHundred() {
    // "cien" when exactly 100, not "ciento"
    assertThat(SpanishNumberToWords.toWords(100)).isEqualTo("cien");
  }

  @Test
  void toWords_oneHundredToNineHundredNinetyNine() {
    assertThat(SpanishNumberToWords.toWords(101)).isEqualTo("ciento uno");
    assertThat(SpanishNumberToWords.toWords(150)).isEqualTo("ciento cincuenta");
    assertThat(SpanishNumberToWords.toWords(500)).isEqualTo("quinientos");
    assertThat(SpanishNumberToWords.toWords(700)).isEqualTo("setecientos");
    assertThat(SpanishNumberToWords.toWords(900)).isEqualTo("novecientos");
    assertThat(SpanishNumberToWords.toWords(999)).isEqualTo("novecientos noventa y nueve");
  }

  @Test
  void toWords_exactlyOneThousand() {
    assertThat(SpanishNumberToWords.toWords(1_000)).isEqualTo("mil");
  }

  @Test
  void toWords_thousandsRange() {
    assertThat(SpanishNumberToWords.toWords(1_001)).isEqualTo("mil uno");
    assertThat(SpanishNumberToWords.toWords(2_000)).isEqualTo("dos mil");
    assertThat(SpanishNumberToWords.toWords(150_000)).isEqualTo("ciento cincuenta mil");
    assertThat(SpanishNumberToWords.toWords(999_999))
        .isEqualTo("novecientos noventa y nueve mil novecientos noventa y nueve");
  }

  @Test
  void toWords_millions() {
    assertThat(SpanishNumberToWords.toWords(1_000_000)).isEqualTo("un millón");
    assertThat(SpanishNumberToWords.toWords(2_000_000)).isEqualTo("dos millones");
    assertThat(SpanishNumberToWords.toWords(1_500_000)).isEqualTo("un millón quinientos mil");
    assertThat(SpanishNumberToWords.toWords(10_000_000)).isEqualTo("diez millones");
    assertThat(SpanishNumberToWords.toWords(100_000_000)).isEqualTo("cien millones");
  }

  @Test
  void toWords_negativeThrows() {
    assertThatThrownBy(() -> SpanishNumberToWords.toWords(-1))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void toWords_tooLargeThrows() {
    assertThatThrownBy(() -> SpanishNumberToWords.toWords(1_000_000_000L))
        .isInstanceOf(IllegalArgumentException.class);
  }

  // ─── guaranies ──────────────────────────────────────────────────────────────

  @Test
  void guaranies_appendsSuffix() {
    assertThat(SpanishNumberToWords.guaranies(new BigDecimal("150000")))
        .isEqualTo("ciento cincuenta mil guaraníes");
  }

  @Test
  void guaranies_zero() {
    assertThat(SpanishNumberToWords.guaranies(BigDecimal.ZERO)).isEqualTo("cero guaraníes");
  }

  @Test
  void guaranies_null() {
    assertThat(SpanishNumberToWords.guaranies(null)).isEqualTo("cero guaraníes");
  }

  @Test
  void guaranies_roundsDecimalsBeforeConversion() {
    // Should round 100.50 → 101
    assertThat(SpanishNumberToWords.guaranies(new BigDecimal("100.50")))
        .isEqualTo("ciento uno guaraníes");
  }

  @Test
  void guaranies_typicalDemoAmounts() {
    // Common amounts seen in demo salon invoices
    assertThat(SpanishNumberToWords.guaranies(new BigDecimal("50000")))
        .isEqualTo("cincuenta mil guaraníes");
    assertThat(SpanishNumberToWords.guaranies(new BigDecimal("890000")))
        .isEqualTo("ochocientos noventa mil guaraníes");
    assertThat(SpanishNumberToWords.guaranies(new BigDecimal("1000000")))
        .isEqualTo("un millón guaraníes");
  }
}
