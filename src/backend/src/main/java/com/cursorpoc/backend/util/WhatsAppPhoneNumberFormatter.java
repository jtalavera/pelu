package com.cursorpoc.backend.util;

/**
 * Issue #225: converts a client's on-file phone number into a Meta WhatsApp Cloud API destination
 * (E.164-ish, e.g. {@code +595981234567}).
 *
 * <p>Clients are only ever asked for a <em>local</em> Paraguay number -- 4-digit area code
 * (starting with the trunk prefix {@code 0}) + 6-digit subscriber, 10 digits total, per {@link
 * ParaguayPhoneValidator} / the frontend's {@code isCompleteParaguayPhone} -- never a country code.
 * So phone numbers are NOT stored WhatsApp-ready and must be derived here: strip non-digits, and
 * when what's left is the complete 10-digit local shape starting with the trunk {@code 0}, drop
 * that {@code 0} and prefix Paraguay's country code ({@code 595}). A number already keyed in with
 * the country code (e.g. via an API integration) is passed through with a leading {@code +}.
 * Anything else -- incomplete, malformed, or a shape this app has no format expectation for --
 * returns {@code null} so the caller skips the WhatsApp channel rather than guessing at a
 * destination Meta would just reject.
 */
public final class WhatsAppPhoneNumberFormatter {

  private static final String PARAGUAY_COUNTRY_CODE = "595";
  private static final int LOCAL_DIGITS_WITH_TRUNK_PREFIX = 10;
  private static final int MIN_E164_WITH_COUNTRY_CODE_DIGITS = 11;
  private static final int MAX_E164_WITH_COUNTRY_CODE_DIGITS = 13;

  private WhatsAppPhoneNumberFormatter() {}

  public static String toWhatsAppDestination(String rawPhone) {
    if (rawPhone == null) {
      return null;
    }
    String digits = rawPhone.replaceAll("\\D+", "");
    if (digits.isEmpty()) {
      return null;
    }

    if (digits.length() == LOCAL_DIGITS_WITH_TRUNK_PREFIX && digits.startsWith("0")) {
      return "+" + PARAGUAY_COUNTRY_CODE + digits.substring(1);
    }

    if (digits.length() >= MIN_E164_WITH_COUNTRY_CODE_DIGITS
        && digits.length() <= MAX_E164_WITH_COUNTRY_CODE_DIGITS
        && digits.startsWith(PARAGUAY_COUNTRY_CODE)) {
      return "+" + digits;
    }

    return null;
  }
}
