package com.cursorpoc.backend.util;

import java.util.Optional;
import java.util.regex.Pattern;

/**
 * HU-WAP-01 (criterio 4): the single place that turns a typed phone number into international
 * format ({@code +595981123456}). Booking, clients and WhatsApp sending all use it.
 *
 * <p>Paraguayan mobiles are accepted as {@code 0981123456}, {@code 981123456}, {@code
 * +595981123456} and {@code 595981123456} (spaces, hyphens, dots and parentheses are ignored);
 * landlines and wrong lengths are rejected. Any other country needs the {@code +} (or {@code 00})
 * prefix.
 */
public final class PhoneNumberNormalizer {

  private static final Pattern ALLOWED_CHARS = Pattern.compile("[+\\d\\s().\\-]+");
  private static final Pattern PY_MOBILE_NATIONAL = Pattern.compile("9\\d{8}");
  private static final int MIN_INTERNATIONAL_DIGITS = 8;
  private static final int MAX_INTERNATIONAL_DIGITS = 15;

  private PhoneNumberNormalizer() {}

  /** Returns the E.164 form ({@code +<digits>}), or empty when the input cannot be normalized. */
  public static Optional<String> normalize(String raw) {
    if (raw == null) {
      return Optional.empty();
    }
    String trimmed = raw.trim();
    if (trimmed.isEmpty() || !ALLOWED_CHARS.matcher(trimmed).matches()) {
      return Optional.empty();
    }
    // A "+" is only meaningful as the very first character.
    if (trimmed.indexOf('+') > 0 || trimmed.lastIndexOf('+') > 0) {
      return Optional.empty();
    }
    boolean international = trimmed.startsWith("+");
    String digits = trimmed.replaceAll("\\D", "");
    if (digits.isEmpty()) {
      return Optional.empty();
    }
    if (!international && digits.startsWith("00")) {
      international = true;
      digits = digits.substring(2);
    }
    if (international) {
      if (digits.startsWith("595")) {
        return paraguayMobile(digits.substring(3));
      }
      if (digits.startsWith("0")
          || digits.length() < MIN_INTERNATIONAL_DIGITS
          || digits.length() > MAX_INTERNATIONAL_DIGITS) {
        return Optional.empty();
      }
      return Optional.of("+" + digits);
    }
    if (digits.startsWith("595")) {
      return paraguayMobile(digits.substring(3));
    }
    if (digits.startsWith("0")) {
      return paraguayMobile(digits.substring(1));
    }
    return paraguayMobile(digits);
  }

  public static boolean isValid(String raw) {
    return normalize(raw).isPresent();
  }

  /**
   * Masks a phone number for logs and retained records (RT-13): keeps the country prefix and the
   * last three digits, e.g. {@code +595*****456}.
   */
  public static String mask(String phone) {
    if (phone == null || phone.isBlank()) {
      return "";
    }
    String p = phone.trim();
    int length = p.length();
    if (length <= 7) {
      return "*".repeat(length);
    }
    return p.substring(0, 4) + "*".repeat(length - 7) + p.substring(length - 3);
  }

  private static Optional<String> paraguayMobile(String national) {
    return PY_MOBILE_NATIONAL.matcher(national).matches()
        ? Optional.of("+595" + national)
        : Optional.empty();
  }
}
