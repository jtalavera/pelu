package com.cursorpoc.backend.service;

import java.security.SecureRandom;
import java.time.format.DateTimeFormatter;
import org.springframework.stereotype.Service;

/**
 * HU-01: builds a document's 44-character número de control (CDC), per SIFEN's Manual Técnico
 * sección 10.1/10.2. Pure computation — no persistence, no network. {@link #build} is a
 * deterministic function of its input (AC-06): calling it twice with the same {@link
 * SifenControlNumberFields} (in particular the same {@code securityCode}) always returns the same
 * CDC. Whoever calls this for a given invoice is responsible for generating the security code once
 * (via {@link #generateSecurityCode}) and reusing it — usually by persisting it alongside the
 * invoice — on any subsequent regeneration of the same document's CDC.
 */
@Service
public class SifenControlNumberService {

  private static final SecureRandom RANDOM = new SecureRandom();
  private static final DateTimeFormatter ISSUE_DATE_FORMAT =
      DateTimeFormatter.ofPattern("yyyyMMdd");

  /**
   * Módulo 11: weights cycle 2..11 right-to-left; basemax = 11 (SET's dígito-verificador
   * algorithm).
   */
  private static final int WEIGHT_BASE_MAX = 11;

  /** Builds the 44-character CDC from {@code fields} (AC-01), zero-padding as needed (AC-03). */
  public String build(SifenControlNumberFields fields) {
    String base =
        pad(fields.documentType(), 2)
            + pad(fields.issuerRuc(), 8)
            + pad(fields.issuerRucCheckDigit(), 1)
            + pad(fields.establishment(), 3)
            + pad(fields.expeditionPoint(), 3)
            + pad(fields.documentNumber(), 7)
            + pad(fields.taxpayerType(), 1)
            + fields.issueDate().format(ISSUE_DATE_FORMAT)
            + pad(fields.emissionType(), 1)
            + pad(fields.securityCode(), 9);
    return base + checkDigit(base);
  }

  /**
   * Recomputes the check digit from the first 43 characters of {@code controlNumber} and compares
   * it against the 44th (AC-02): detects a CDC that was transcribed or altered incorrectly.
   */
  public boolean isValid(String controlNumber) {
    if (controlNumber == null || controlNumber.length() != 44) {
      return false;
    }
    String base = controlNumber.substring(0, 43);
    char expected = controlNumber.charAt(43);
    return checkDigit(base) == expected;
  }

  /**
   * Generates the 9-digit random dCodSeg (AC-04): never equal, as a number, to {@code
   * documentNumber} — retries until that holds, rather than relying on the odds of a 9-digit space
   * colliding with a 7-digit one.
   */
  public String generateSecurityCode(long documentNumber) {
    long candidate;
    do {
      candidate = 1 + (long) (RANDOM.nextDouble() * 999_999_999L);
    } while (candidate == documentNumber);
    return pad(candidate, 9);
  }

  private static char checkDigit(String base43) {
    int total = 0;
    int weight = 2;
    for (int i = base43.length() - 1; i >= 0; i--) {
      int digit = Character.digit(base43.charAt(i), 10);
      if (digit < 0) {
        throw new IllegalArgumentException("Non-digit character in CDC base: " + base43);
      }
      total += digit * weight;
      weight = weight == WEIGHT_BASE_MAX ? 2 : weight + 1;
    }
    int remainder = total % 11;
    int dv = remainder > 1 ? 11 - remainder : 0;
    return Character.forDigit(dv, 10);
  }

  private static String pad(long value, int length) {
    if (value < 0) {
      throw new IllegalArgumentException("Value must not be negative: " + value);
    }
    return pad(Long.toString(value), length);
  }

  private static String pad(String raw, int length) {
    if (raw == null || raw.isEmpty() || !raw.chars().allMatch(Character::isDigit)) {
      throw new IllegalArgumentException("Value must be a non-empty digit string: " + raw);
    }
    if (raw.length() > length) {
      throw new IllegalArgumentException(
          "Value \"" + raw + "\" exceeds the CDC field length of " + length);
    }
    return "0".repeat(length - raw.length()) + raw;
  }
}
