package com.cursorpoc.backend.util;

/**
 * Paraguay local phone number format: 4-digit area code + 6-digit subscriber number (10 digits
 * total). Mirrors the frontend's {@code isCompleteParaguayPhone} rule ({@code
 * lib/paraguayPhone.ts}), used by the manual client/professional creation forms — non-digit
 * characters (parentheses, spaces, hyphens) are stripped before counting.
 */
public final class ParaguayPhoneValidator {

  private static final int TOTAL_LOCAL_DIGITS = 10;

  private ParaguayPhoneValidator() {}

  public static boolean isComplete(String phone) {
    if (phone == null) {
      return false;
    }
    String digits = phone.replaceAll("\\D+", "");
    return digits.length() == TOTAL_LOCAL_DIGITS;
  }
}
