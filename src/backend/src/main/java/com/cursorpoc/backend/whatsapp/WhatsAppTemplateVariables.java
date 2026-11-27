package com.cursorpoc.backend.whatsapp;

import java.text.Normalizer;
import java.util.Locale;
import java.util.regex.Pattern;

/** HU-WAP-02 (criterio 4): cleans the values that go into template variables. */
public final class WhatsAppTemplateVariables {

  /** Meta rejects variables with line breaks, tabs or runs of 4+ spaces; we also cap the length. */
  public static final int MAX_LENGTH = 60;

  /** Used when the client's name is empty so the greeting still reads naturally. */
  public static final String FALLBACK_GREETING_NAME = "clienta";

  private static final Pattern WHITESPACE = Pattern.compile("[\\s\\p{Cntrl}]+");

  private WhatsAppTemplateVariables() {}

  /** Single line, collapsed spaces, trimmed, at most {@link #MAX_LENGTH} characters. */
  public static String sanitize(String raw) {
    if (raw == null) {
      return "";
    }
    String s = WHITESPACE.matcher(raw).replaceAll(" ").trim();
    if (s.length() > MAX_LENGTH) {
      s = s.substring(0, MAX_LENGTH).trim();
    }
    return s;
  }

  /**
   * First given name with an initial capital ("MARÍA JOSÉ lópez" → "María"). Empty or blank names
   * give {@link #FALLBACK_GREETING_NAME}.
   */
  public static String firstName(String fullName) {
    String clean = sanitize(fullName);
    if (clean.isEmpty()) {
      return FALLBACK_GREETING_NAME;
    }
    String first = clean.split(" ")[0];
    String lower = first.toLowerCase(Locale.ROOT);
    String normalized = Normalizer.normalize(lower, Normalizer.Form.NFC);
    if (normalized.isEmpty()) {
      return FALLBACK_GREETING_NAME;
    }
    return normalized.substring(0, 1).toUpperCase(Locale.ROOT) + normalized.substring(1);
  }
}
