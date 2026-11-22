package com.cursorpoc.backend.assistant;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

/**
 * Same rule as the frontend's formatGuaraniesGs: «Gs. » + point as thousands separator, no
 * decimals.
 */
class AssistantMoneyTest {

  @ParameterizedTest
  @CsvSource({
    "0, Gs. 0",
    "500, Gs. 500",
    "50000, Gs. 50.000",
    "50000.00, Gs. 50.000",
    "1234567, Gs. 1.234.567",
    "110000.4, Gs. 110.000",
    "110000.5, Gs. 110.001",
  })
  void formatsLikeTheApp(String amount, String expected) {
    assertThat(AssistantMoney.gs(new BigDecimal(amount))).isEqualTo(expected);
  }

  @Test
  void aMissingAmountIsADash() {
    assertThat(AssistantMoney.gs(null)).isEqualTo("Gs. —");
  }
}
