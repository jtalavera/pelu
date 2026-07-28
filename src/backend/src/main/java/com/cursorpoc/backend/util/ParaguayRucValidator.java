package com.cursorpoc.backend.util;

import java.util.regex.Pattern;

/**
 * Paraguay RUC format: digits, hyphen, digits (no check-digit or length validation; pattern only).
 */
public final class ParaguayRucValidator {

  private static final Pattern PATTERN = Pattern.compile("^\\d+-\\d+$");

  private ParaguayRucValidator() {}

  public static boolean isValid(String ruc) {
    if (ruc == null || ruc.isBlank()) {
      return false;
    }
    return PATTERN.matcher(ruc.trim()).matches();
  }

  /** Base RUC digits and check digit, split at the hyphen — e.g. {@code "1137152-8"}. */
  public record RucParts(String base, int checkDigit) {}

  /**
   * Splits a valid RUC into its base digits and check digit (SIFEN D101/dRucEm, D102/dDVEmi).
   *
   * @throws IllegalArgumentException if {@code ruc} does not match {@link #isValid}.
   */
  public static RucParts split(String ruc) {
    if (!isValid(ruc)) {
      throw new IllegalArgumentException("Not a valid RUC: " + ruc);
    }
    String[] parts = ruc.trim().split("-", 2);
    return new RucParts(parts[0], Integer.parseInt(parts[1]));
  }
}
