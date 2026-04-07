package com.cursorpoc.backend.util;

import java.util.regex.Pattern;

/**
 * Paraguay RUC check digit (SET modulo 11, base max 11). Format: eight digits, hyphen, one digit.
 */
public final class ParaguayRucValidator {

  private static final Pattern PATTERN = Pattern.compile("^\\d{8}-\\d$");

  private ParaguayRucValidator() {}

  public static boolean isValid(String ruc) {
    if (ruc == null || ruc.isBlank()) {
      return false;
    }
    String trimmed = ruc.trim();
    if (!PATTERN.matcher(trimmed).matches()) {
      return false;
    }
    String[] parts = trimmed.split("-");
    String base = parts[0];
    int expectedDv = Integer.parseInt(parts[1]);
    return computeVerificationDigit(base) == expectedDv;
  }

  /** Visible for tests: base must be exactly 8 digits. */
  public static int computeVerificationDigit(String eightDigits) {
    int baseMax = 11;
    int k = 2;
    int total = 0;
    for (int i = eightDigits.length() - 1; i >= 0; i--) {
      if (k > baseMax) {
        k = 2;
      }
      int v = Character.digit(eightDigits.charAt(i), 10);
      total += v * k;
      k++;
    }
    int rest = total % 11;
    if (rest > 1) {
      return 11 - rest;
    }
    return 0;
  }
}
