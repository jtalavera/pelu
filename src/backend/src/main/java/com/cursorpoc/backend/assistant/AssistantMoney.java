package com.cursorpoc.backend.assistant;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.util.Locale;

/**
 * Guaraníes as the app shows them everywhere (same rule as the frontend's {@code
 * formatGuaraniesGs}): {@code Gs. } prefix, point as thousands separator, no decimals — {@code Gs.
 * 50.000}. The assistant receives amounts already formatted, so the model never formats (or
 * misformats) a price itself.
 */
final class AssistantMoney {

  private AssistantMoney() {}

  static String gs(BigDecimal amount) {
    if (amount == null) {
      return "Gs. —";
    }
    DecimalFormatSymbols symbols = DecimalFormatSymbols.getInstance(Locale.ROOT);
    symbols.setGroupingSeparator('.');
    symbols.setDecimalSeparator(',');
    DecimalFormat format = new DecimalFormat("#,##0", symbols);
    format.setRoundingMode(RoundingMode.HALF_UP);
    return "Gs. " + format.format(amount.setScale(0, RoundingMode.HALF_UP));
  }
}
