package com.cursorpoc.backend.service;

import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * Converts non-negative whole numbers to their Spanish word representation.
 *
 * <p>Supports values from 0 to 999,999,999 (guaraníes range). The main entry point for invoice PDF
 * use is {@link #guaranies(BigDecimal)}.
 */
final class SpanishNumberToWords {

  private SpanishNumberToWords() {}

  private static final String[] UNITS = {
    "",
    "uno",
    "dos",
    "tres",
    "cuatro",
    "cinco",
    "seis",
    "siete",
    "ocho",
    "nueve",
    "diez",
    "once",
    "doce",
    "trece",
    "catorce",
    "quince",
    "dieciséis",
    "diecisiete",
    "dieciocho",
    "diecinueve",
    "veinte",
    "veintiuno",
    "veintidós",
    "veintitrés",
    "veinticuatro",
    "veinticinco",
    "veintiséis",
    "veintisiete",
    "veintiocho",
    "veintinueve",
  };

  private static final String[] TENS = {
    "",
    "",
    "veinte",
    "treinta",
    "cuarenta",
    "cincuenta",
    "sesenta",
    "setenta",
    "ochenta",
    "noventa",
  };

  private static final String[] HUNDREDS = {
    "",
    "ciento",
    "doscientos",
    "trescientos",
    "cuatrocientos",
    "quinientos",
    "seiscientos",
    "setecientos",
    "ochocientos",
    "novecientos",
  };

  /**
   * Converts a monetary amount (whole guaraníes) to the Spanish words string appended with "
   * guaraníes", e.g. {@code 150_000 → "ciento cincuenta mil guaraníes"}.
   *
   * <p>The amount is rounded to zero decimal places before conversion.
   *
   * @param amount non-negative amount in guaraníes
   * @return localised string for use in invoice PDFs
   */
  static String guaranies(BigDecimal amount) {
    if (amount == null) {
      return "cero guaraníes";
    }
    long value = amount.setScale(0, RoundingMode.HALF_UP).longValueExact();
    return toWords(value) + " guaraníes";
  }

  /**
   * Converts a non-negative whole number to its Spanish word representation.
   *
   * @param n value in the range [0, 999_999_999]
   * @return Spanish words for {@code n}
   * @throws IllegalArgumentException if {@code n} is negative or exceeds supported range
   */
  static String toWords(long n) {
    if (n < 0) {
      throw new IllegalArgumentException("Negative numbers are not supported: " + n);
    }
    if (n == 0) {
      return "cero";
    }
    if (n > 999_999_999L) {
      throw new IllegalArgumentException("Number too large (max 999,999,999): " + n);
    }

    StringBuilder sb = new StringBuilder();

    // Millions
    if (n >= 1_000_000L) {
      long millions = n / 1_000_000L;
      n %= 1_000_000L;
      if (millions == 1) {
        sb.append("un millón");
      } else {
        sb.append(belowThousand((int) millions)).append(" millones");
      }
      if (n > 0) {
        sb.append(" ");
      }
    }

    // Thousands
    if (n >= 1_000L) {
      long thousands = n / 1_000L;
      n %= 1_000L;
      if (thousands == 1) {
        sb.append("mil");
      } else {
        sb.append(belowThousand((int) thousands)).append(" mil");
      }
      if (n > 0) {
        sb.append(" ");
      }
    }

    // Remainder < 1000
    if (n > 0) {
      sb.append(belowThousand((int) n));
    }

    return sb.toString();
  }

  /** Converts a number in the range [1, 999] to Spanish words. */
  private static String belowThousand(int n) {
    StringBuilder sb = new StringBuilder();

    // Hundreds
    int hundreds = n / 100;
    int remainder = n % 100;
    if (hundreds > 0) {
      if (hundreds == 1 && remainder == 0) {
        // "cien" when exactly 100, "ciento" when 101-199
        sb.append("cien");
      } else {
        sb.append(HUNDREDS[hundreds]);
      }
      if (remainder > 0) {
        sb.append(" ");
      }
    }

    // Tens + units (0-99)
    if (remainder > 0) {
      if (remainder < 30) {
        sb.append(UNITS[remainder]);
      } else {
        int tens = remainder / 10;
        int units = remainder % 10;
        sb.append(TENS[tens]);
        if (units > 0) {
          sb.append(" y ").append(UNITS[units]);
        }
      }
    }

    return sb.toString();
  }
}
