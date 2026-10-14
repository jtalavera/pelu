package com.cursorpoc.backend.commission;

import com.cursorpoc.backend.domain.CommissionConfigVersion;
import com.cursorpoc.backend.domain.enums.CommissionBaseType;
import com.cursorpoc.backend.domain.enums.CommissionConfigScope;
import com.cursorpoc.backend.domain.enums.CommissionRuleOrigin;
import com.cursorpoc.backend.domain.enums.ServiceKind;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.Optional;

/**
 * Pure calculation rules of the module (§3, §4): percent resolution (beneficiary + item → item →
 * default of the item's kind) and the base (line total after discounts, with or without IVA).
 * Amounts are rounded per entry to the currency minor unit (Gs: no decimals) with HALF_UP.
 */
public final class CommissionCalculator {

  public static final String CURRENCY = "PYG";
  public static final int CURRENCY_SCALE = 0;

  private CommissionCalculator() {}

  public record Resolution(BigDecimal percent, CommissionRuleOrigin origin, Long ruleVersionId) {}

  public record Amounts(BigDecimal baseAmount, BigDecimal commissionAmount) {}

  public static Resolution resolve(
      CommissionConfigSnapshot snapshot,
      long serviceId,
      ServiceKind kind,
      Long professionalId,
      Instant at) {
    if (professionalId != null) {
      Optional<CommissionConfigVersion> exception = snapshot.ruleAt(serviceId, professionalId, at);
      if (exception.isPresent()) {
        return new Resolution(
            new BigDecimal(exception.get().getConfigValue()),
            CommissionRuleOrigin.BENEFICIARY_ITEM,
            exception.get().getId());
      }
    }
    Optional<CommissionConfigVersion> general = snapshot.ruleAt(serviceId, null, at);
    if (general.isPresent()) {
      return new Resolution(
          new BigDecimal(general.get().getConfigValue()),
          CommissionRuleOrigin.ITEM,
          general.get().getId());
    }
    if (kind == ServiceKind.PRODUCT) {
      return new Resolution(
          snapshot.defaultPercentAt(CommissionConfigScope.DEFAULT_PRODUCT, at),
          CommissionRuleOrigin.TENANT_DEFAULT_PRODUCT,
          null);
    }
    return new Resolution(
        snapshot.defaultPercentAt(CommissionConfigScope.DEFAULT_SERVICE, at),
        CommissionRuleOrigin.TENANT_DEFAULT_SERVICE,
        null);
  }

  /**
   * @param lineTotal line total after the line discount, IVA included (prices are IVA-incluido)
   * @param taxAmount IVA contained in {@code lineTotal}
   */
  public static Amounts amounts(
      BigDecimal lineTotal, BigDecimal taxAmount, CommissionBaseType baseType, BigDecimal percent) {
    BigDecimal total = lineTotal == null ? BigDecimal.ZERO : lineTotal;
    BigDecimal tax = taxAmount == null ? BigDecimal.ZERO : taxAmount;
    BigDecimal base = baseType == CommissionBaseType.NET_OF_TAX ? total.subtract(tax) : total;
    if (base.signum() < 0) {
      base = BigDecimal.ZERO;
    }
    BigDecimal commission =
        base.multiply(percent)
            .divide(BigDecimal.valueOf(100), CURRENCY_SCALE, RoundingMode.HALF_UP);
    return new Amounts(base.setScale(2, RoundingMode.HALF_UP), commission.setScale(2));
  }

  /** IVA contained in an IVA-included amount: amount × rate / (100 + rate), 4 decimals. */
  public static BigDecimal includedTax(BigDecimal amount, BigDecimal rate) {
    if (rate == null || rate.signum() == 0) {
      return BigDecimal.ZERO;
    }
    return amount.multiply(rate).divide(BigDecimal.valueOf(100).add(rate), 4, RoundingMode.HALF_UP);
  }
}
