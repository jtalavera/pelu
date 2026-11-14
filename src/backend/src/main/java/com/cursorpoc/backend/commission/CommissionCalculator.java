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
 * Pure calculation rules of the module (§3, §4 and HU-COM-12): rule resolution (professional + item
 * → professional + group → item → group → default of the item's kind) and the amounts of a line:
 * base (line total after discounts, with or without IVA) minus the fixed amount, then the percent
 * that is paid and the percent retained for aguinaldo. Amounts are rounded per entry to the
 * currency minor unit (Gs: no decimals) with HALF_UP.
 */
public final class CommissionCalculator {

  public static final String CURRENCY = "PYG";
  public static final int CURRENCY_SCALE = 0;

  private CommissionCalculator() {}

  /**
   * The rule that applies to a line. {@code retentionPercent} is already 0 when the salon does not
   * retain for aguinaldo; {@code fixedToProfessional} already resolves the tenant default.
   */
  public record Resolution(
      BigDecimal percent,
      BigDecimal retentionPercent,
      BigDecimal fixedAmount,
      boolean fixedToProfessional,
      CommissionRuleOrigin origin,
      Long ruleVersionId) {

    public Resolution(BigDecimal percent, CommissionRuleOrigin origin, Long ruleVersionId) {
      this(percent, BigDecimal.ZERO, BigDecimal.ZERO, true, origin, ruleVersionId);
    }
  }

  public record Amounts(BigDecimal baseAmount, BigDecimal commissionAmount) {}

  /**
   * Amounts of one line. {@code commissionAmount} is what is paid to the professional (the paid %
   * plus the fixed amount when it is hers); {@code retentionAmount} goes to her aguinaldo fund.
   */
  public record LineAmounts(
      BigDecimal baseAmount,
      BigDecimal percentAmount,
      BigDecimal fixedAmount,
      boolean fixedToProfessional,
      BigDecimal retentionAmount,
      BigDecimal commissionAmount) {}

  public static Resolution resolve(
      CommissionConfigSnapshot snapshot,
      long serviceId,
      ServiceKind kind,
      Long professionalId,
      Instant at) {
    return resolve(snapshot, serviceId, null, kind, professionalId, at);
  }

  public static Resolution resolve(
      CommissionConfigSnapshot snapshot,
      long serviceId,
      Long groupId,
      ServiceKind kind,
      Long professionalId,
      Instant at) {
    if (professionalId != null) {
      Optional<CommissionConfigVersion> exception = snapshot.ruleAt(serviceId, professionalId, at);
      if (exception.isPresent()) {
        return fromRule(snapshot, exception.get(), CommissionRuleOrigin.BENEFICIARY_ITEM, at);
      }
      if (groupId != null) {
        Optional<CommissionConfigVersion> groupException =
            snapshot.groupRuleAt(groupId, professionalId, at);
        if (groupException.isPresent()) {
          return fromRule(
              snapshot, groupException.get(), CommissionRuleOrigin.BENEFICIARY_GROUP, at);
        }
      }
    }
    Optional<CommissionConfigVersion> general = snapshot.ruleAt(serviceId, null, at);
    if (general.isPresent()) {
      return fromRule(snapshot, general.get(), CommissionRuleOrigin.ITEM, at);
    }
    if (groupId != null) {
      Optional<CommissionConfigVersion> groupGeneral = snapshot.groupRuleAt(groupId, null, at);
      if (groupGeneral.isPresent()) {
        return fromRule(snapshot, groupGeneral.get(), CommissionRuleOrigin.GROUP, at);
      }
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

  private static Resolution fromRule(
      CommissionConfigSnapshot snapshot,
      CommissionConfigVersion version,
      CommissionRuleOrigin origin,
      Instant at) {
    CommissionRuleValue value = CommissionRuleValue.parse(version.getConfigValue());
    BigDecimal retention =
        snapshot.aguinaldoEnabledAt(at) ? value.retentionPercent() : BigDecimal.ZERO;
    CommissionRuleValue.FixedDestination destination =
        value.fixedDestination() != null
            ? value.fixedDestination()
            : snapshot.fixedDestinationAt(at);
    return new Resolution(
        value.percent(),
        retention,
        value.fixedAmount(),
        destination == CommissionRuleValue.FixedDestination.PROFESSIONAL,
        origin,
        version.getId());
  }

  /** Percent-only amounts (no fixed amount, no retention). */
  public static Amounts amounts(
      BigDecimal lineTotal, BigDecimal taxAmount, CommissionBaseType baseType, BigDecimal percent) {
    LineAmounts a = amounts(lineTotal, taxAmount, baseType, new Resolution(percent, null, null));
    return new Amounts(a.baseAmount(), a.commissionAmount());
  }

  /**
   * @param lineTotal line total after the line discount, IVA included (prices are IVA-incluido)
   * @param taxAmount IVA contained in {@code lineTotal}
   */
  public static LineAmounts amounts(
      BigDecimal lineTotal,
      BigDecimal taxAmount,
      CommissionBaseType baseType,
      Resolution resolution) {
    BigDecimal total = lineTotal == null ? BigDecimal.ZERO : lineTotal;
    BigDecimal tax = taxAmount == null ? BigDecimal.ZERO : taxAmount;
    BigDecimal gross = baseType == CommissionBaseType.NET_OF_TAX ? total.subtract(tax) : total;
    if (gross.signum() < 0) {
      gross = BigDecimal.ZERO;
    }
    // The fixed amount (costo de producto) only applies to lines that carry a price.
    BigDecimal fixed =
        gross.signum() > 0 && resolution.fixedAmount() != null
            ? resolution.fixedAmount().setScale(CURRENCY_SCALE, RoundingMode.HALF_UP)
            : BigDecimal.ZERO;
    BigDecimal base = gross.subtract(fixed);
    if (base.signum() < 0) {
      base = BigDecimal.ZERO;
    }
    BigDecimal percentAmount = percentOf(base, resolution.percent());
    BigDecimal retention = percentOf(base, resolution.retentionPercent());
    BigDecimal commission =
        resolution.fixedToProfessional() ? percentAmount.add(fixed) : percentAmount;
    return new LineAmounts(
        base.setScale(2, RoundingMode.HALF_UP),
        percentAmount.setScale(2),
        fixed.setScale(2),
        resolution.fixedToProfessional(),
        retention.setScale(2),
        commission.setScale(2));
  }

  private static BigDecimal percentOf(BigDecimal base, BigDecimal percent) {
    if (percent == null) {
      return BigDecimal.ZERO.setScale(CURRENCY_SCALE);
    }
    return base.multiply(percent)
        .divide(BigDecimal.valueOf(100), CURRENCY_SCALE, RoundingMode.HALF_UP);
  }

  /** IVA contained in an IVA-included amount: amount × rate / (100 + rate), 4 decimals. */
  public static BigDecimal includedTax(BigDecimal amount, BigDecimal rate) {
    if (rate == null || rate.signum() == 0) {
      return BigDecimal.ZERO;
    }
    return amount.multiply(rate).divide(BigDecimal.valueOf(100).add(rate), 4, RoundingMode.HALF_UP);
  }
}
