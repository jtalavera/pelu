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
}
