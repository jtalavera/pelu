package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.LocalDate;
import org.junit.jupiter.api.Test;

class SifenControlNumberServiceTest {

  private final SifenControlNumberService service = new SifenControlNumberService();

  /**
   * AC-01/AC-02: golden example straight from the Manual Técnico V150 (sección 10.1, "Para lograr
   * una mayor comprensión se describe a continuación un ejemplo de cómo generar un CDC"), including
   * its officially-computed check digit (8) — the strongest anchor available since it's the
   * document's own worked example, not a value we derived ourselves.
   */
  @Test
  void build_matchesManualsWorkedExample() {
    SifenControlNumberFields fields =
        new SifenControlNumberFields(
            1, "44444401", 7, 1, 1, 14528, 2, LocalDate.of(2017, 1, 25), 1, "587326098");

    String cdc = service.build(fields);

    assertThat(cdc).isEqualTo("01444444017001001001452822017012515873260988");
    assertThat(cdc).hasSize(44);
    assertThat(service.isValid(cdc)).isTrue();
  }

  @Test
  void build_alwaysProduces44Characters() {
    SifenControlNumberFields fields =
        new SifenControlNumberFields(
            1, "1137152", 8, 1, 2, 1, 2, LocalDate.of(2026, 7, 28), 1, "123456789");

    assertThat(service.build(fields)).hasSize(44);
  }

  /** AC-03: RUC and número de documento shorter than required are left-zero-padded. */
  @Test
  void build_leftPadsShortRucAndDocumentNumber() {
    SifenControlNumberFields fields =
        new SifenControlNumberFields(
            1, "441", 9, 1, 1, 45, 1, LocalDate.of(2026, 7, 28), 1, "000000001");

    String cdc = service.build(fields);

    // documentType(2) + issuerRuc(8) -> positions [2,10)
    assertThat(cdc.substring(2, 10)).isEqualTo("00000441");
    // ... + DV(1) + establishment(3) + expeditionPoint(3) -> documentNumber(7) at [17,24)
    assertThat(cdc.substring(17, 24)).isEqualTo("0000045");
  }

  /** AC-04: the security code is never equal, as a number, to the invoice's document number. */
  @Test
  void generateSecurityCode_neverEqualsDocumentNumber() {
    for (long documentNumber : new long[] {1L, 14528L, 9_999_999L}) {
      for (int i = 0; i < 200; i++) {
        String code = service.generateSecurityCode(documentNumber);
        assertThat(code).hasSize(9).matches("\\d{9}");
        assertThat(Long.parseLong(code)).isNotEqualTo(documentNumber);
      }
    }
  }

  /** AC-05: two documents with different data always produce different CDCs. */
  @Test
  void build_differentInvoicesProduceDifferentCdc() {
    SifenControlNumberFields a =
        new SifenControlNumberFields(
            1, "1137152", 8, 1, 1, 1, 2, LocalDate.of(2026, 7, 28), 1, "111111112");
    SifenControlNumberFields b =
        new SifenControlNumberFields(
            1, "1137152", 8, 1, 1, 2, 2, LocalDate.of(2026, 7, 28), 1, "111111113");

    assertThat(service.build(a)).isNotEqualTo(service.build(b));
  }

  /**
   * AC-06: regenerating the CDC for the same already-processed invoice (same fields, same stored
   * security code) always returns the same result — it must not be re-randomized on every call.
   */
  @Test
  void build_isDeterministicForTheSameFields() {
    SifenControlNumberFields fields =
        new SifenControlNumberFields(
            1, "1137152", 8, 1, 1, 14528, 2, LocalDate.of(2026, 7, 28), 1, "587326098");

    assertThat(service.build(fields)).isEqualTo(service.build(fields));
  }

  /** AC-02: an altered CDC fails validation — the check digit no longer matches. */
  @Test
  void isValid_detectsAnAlteredCdc() {
    SifenControlNumberFields fields =
        new SifenControlNumberFields(
            1, "1137152", 8, 1, 1, 14528, 2, LocalDate.of(2026, 7, 28), 1, "587326098");
    String cdc = service.build(fields);
    assertThat(service.isValid(cdc)).isTrue();

    // Flip a digit inside the security-code segment (rightmost 9 chars before the check digit).
    char untouched = cdc.charAt(35);
    char flipped = untouched == '5' ? '6' : '5';
    String altered = cdc.substring(0, 35) + flipped + cdc.substring(36);

    assertThat(service.isValid(altered)).isFalse();
  }

  @Test
  void isValid_rejectsWrongLength() {
    assertThat(service.isValid("123")).isFalse();
    assertThat(service.isValid(null)).isFalse();
  }

  @Test
  void build_rejectsValuesThatDoNotFitTheirField() {
    SifenControlNumberFields tooLongRuc =
        new SifenControlNumberFields(
            1, "123456789", 8, 1, 1, 1, 2, LocalDate.of(2026, 7, 28), 1, "111111112");

    assertThatThrownBy(() -> service.build(tooLongRuc))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
