package com.cursorpoc.backend.util;

/**
 * Lightweight email format check mirroring the frontend's {@code isValidEmail} ({@code
 * lib/validateEmail.ts}), used by the manual client/professional creation forms: exactly one
 * {@code @}, a non-empty local part, a domain that contains a dot, and no whitespace. Not RFC-5322
 * strict — deliberately permissive, matching the same product rule.
 */
public final class EmailFormatValidator {

  private EmailFormatValidator() {}

  public static boolean isValid(String email) {
    if (email == null) {
      return false;
    }
    String value = email.trim();
    if (value.isEmpty() || value.chars().filter(c -> c == '@').count() != 1) {
      return false;
    }
    int at = value.indexOf('@');
    String local = value.substring(0, at);
    String domain = value.substring(at + 1);
    if (local.isEmpty() || domain.isEmpty() || !domain.contains(".")) {
      return false;
    }
    return value.chars().noneMatch(Character::isWhitespace);
  }
}
