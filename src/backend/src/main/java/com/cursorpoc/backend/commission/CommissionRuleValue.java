package com.cursorpoc.backend.commission;

import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * Value of a RULE / GROUP_RULE version. Plain percent ("45") is the original format; the rich
 * format is {@code pago|retención|montoFijo|destino} (e.g. {@code 45|5|3000|P}). The destination is
 * {@code P} (profesional), {@code S} (salón) or empty (el destino por defecto del salón).
 */
public record CommissionRuleValue(
    BigDecimal percent,
    BigDecimal retentionPercent,
    BigDecimal fixedAmount,
    FixedDestination fixedDestination) {

  public enum FixedDestination {
    PROFESSIONAL("P"),
    SALON("S");

    private final String code;

    FixedDestination(String code) {
      this.code = code;
    }

    public String code() {
      return code;
    }

    static FixedDestination ofCode(String raw) {
      if (raw == null || raw.isBlank()) {
        return null;
      }
      for (FixedDestination d : values()) {
        if (d.code.equalsIgnoreCase(raw.trim()) || d.name().equalsIgnoreCase(raw.trim())) {
          return d;
        }
      }
      throw new IllegalArgumentException("fixed destination " + raw);
    }
  }

  public static CommissionRuleValue ofPercent(BigDecimal percent) {
    return new CommissionRuleValue(percent, BigDecimal.ZERO, BigDecimal.ZERO, null);
  }

  /** Parses a stored value (plain percent or rich); throws IllegalArgumentException if invalid. */
  public static CommissionRuleValue parse(String raw) {
    if (raw == null || raw.isBlank()) {
      throw new IllegalArgumentException("empty rule value");
    }
    String[] parts = raw.split("\\|", -1);
    if (parts.length > 4) {
      throw new IllegalArgumentException("rule value " + raw);
    }
    BigDecimal percent = number(parts[0]);
    BigDecimal retention = parts.length > 1 ? number(parts[1]) : BigDecimal.ZERO;
    BigDecimal fixed = parts.length > 2 ? number(parts[2]) : BigDecimal.ZERO;
    FixedDestination destination = parts.length > 3 ? FixedDestination.ofCode(parts[3]) : null;
    return new CommissionRuleValue(percent, retention, fixed, destination);
  }

  private static BigDecimal number(String s) {
    if (s == null || s.isBlank()) {
      return BigDecimal.ZERO;
    }
    return new BigDecimal(s.trim().replace(',', '.'));
  }

  /** Canonical stored form: plain percent when nothing else is set. */
  public String serialize() {
    boolean plain =
        retentionPercent.signum() == 0 && fixedAmount.signum() == 0 && fixedDestination == null;
    String pct = percent.setScale(2, RoundingMode.UNNECESSARY).toPlainString();
    if (plain) {
      return pct;
    }
    return pct
        + "|"
        + retentionPercent.setScale(2, RoundingMode.UNNECESSARY).toPlainString()
        + "|"
        + fixedAmount.stripTrailingZeros().toPlainString()
        + "|"
        + (fixedDestination == null ? "" : fixedDestination.code());
  }
}
