package com.cursorpoc.backend.commission;

import static org.assertj.core.api.Assertions.assertThat;

import com.cursorpoc.backend.domain.CommissionConfigVersion;
import com.cursorpoc.backend.domain.enums.CommissionApplyMode;
import com.cursorpoc.backend.domain.enums.CommissionBaseType;
import com.cursorpoc.backend.domain.enums.CommissionConfigScope;
import com.cursorpoc.backend.domain.enums.CommissionRuleOrigin;
import com.cursorpoc.backend.domain.enums.CommissionVersionStatus;
import com.cursorpoc.backend.domain.enums.ServiceKind;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

class CommissionCalculatorTest {

  private static long ids = 1;

  private static CommissionConfigVersion v(
      CommissionConfigScope scope,
      Long serviceId,
      Long professionalId,
      String value,
      Instant from) {
    CommissionConfigVersion v = new CommissionConfigVersion();
    v.setId(ids++);
    v.setScope(scope);
    v.setServiceId(serviceId);
    v.setProfessionalId(professionalId);
    v.setConfigValue(value);
    v.setEffectiveFrom(from);
    v.setApplyMode(CommissionApplyMode.IMMEDIATE);
    v.setStatus(CommissionVersionStatus.ACTIVE);
    return v;
  }

  @Test
  void docExampleWithAndWithoutTax() {
    // §4.2: 110.000 Gs IVA 10 % included, 40 %.
    BigDecimal tax = CommissionCalculator.includedTax(new BigDecimal("110000"), BigDecimal.TEN);
    assertThat(
            CommissionCalculator.amounts(
                    new BigDecimal("110000"),
                    tax,
                    CommissionBaseType.NET_OF_TAX,
                    new BigDecimal("40"))
                .commissionAmount())
        .isEqualByComparingTo("40000");
    assertThat(
            CommissionCalculator.amounts(
                    new BigDecimal("110000"),
                    tax,
                    CommissionBaseType.TAX_INCLUDED,
                    new BigDecimal("40"))
                .commissionAmount())
        .isEqualByComparingTo("44000");
    // With a 10.000 discount: lineNet 100.000 → 36.364 / 40.000.
    BigDecimal tax2 = CommissionCalculator.includedTax(new BigDecimal("100000"), BigDecimal.TEN);
    assertThat(
            CommissionCalculator.amounts(
                    new BigDecimal("100000"),
                    tax2,
                    CommissionBaseType.NET_OF_TAX,
                    new BigDecimal("40"))
                .commissionAmount())
        .isEqualByComparingTo("36364");
    assertThat(
            CommissionCalculator.amounts(
                    new BigDecimal("100000"),
                    tax2,
                    CommissionBaseType.TAX_INCLUDED,
                    new BigDecimal("40"))
                .commissionAmount())
        .isEqualByComparingTo("40000");
  }

  @Test
  void exemptLineGivesSameBaseBothWays() {
    assertThat(
            CommissionCalculator.amounts(
                    new BigDecimal("50000"),
                    BigDecimal.ZERO,
                    CommissionBaseType.NET_OF_TAX,
                    BigDecimal.TEN)
                .commissionAmount())
        .isEqualByComparingTo(
            CommissionCalculator.amounts(
                    new BigDecimal("50000"),
                    BigDecimal.ZERO,
                    CommissionBaseType.TAX_INCLUDED,
                    BigDecimal.TEN)
                .commissionAmount());
  }

  @Test
  void resolutionOrderExceptionThenGeneralThenDefaultOfKind() {
    Instant t0 = Instant.parse("2026-01-01T00:00:00Z");
    Instant now = Instant.parse("2026-06-01T00:00:00Z");
    var snapshot =
        new CommissionConfigSnapshot(
            List.of(
                v(CommissionConfigScope.DEFAULT_SERVICE, null, null, "20.00", t0),
                v(CommissionConfigScope.DEFAULT_PRODUCT, null, null, "5.00", t0),
                v(CommissionConfigScope.RULE, 10L, null, "40.00", t0),
                v(CommissionConfigScope.RULE, 10L, 7L, "50.00", t0)));
    var exception = CommissionCalculator.resolve(snapshot, 10L, ServiceKind.SERVICE, 7L, now);
    assertThat(exception.percent()).isEqualByComparingTo("50");
    assertThat(exception.origin()).isEqualTo(CommissionRuleOrigin.BENEFICIARY_ITEM);
    var general = CommissionCalculator.resolve(snapshot, 10L, ServiceKind.SERVICE, 8L, now);
    assertThat(general.percent()).isEqualByComparingTo("40");
    assertThat(general.origin()).isEqualTo(CommissionRuleOrigin.ITEM);
    var service = CommissionCalculator.resolve(snapshot, 11L, ServiceKind.SERVICE, 7L, now);
    assertThat(service.origin()).isEqualTo(CommissionRuleOrigin.TENANT_DEFAULT_SERVICE);
    var product = CommissionCalculator.resolve(snapshot, 12L, ServiceKind.PRODUCT, 7L, now);
    assertThat(product.percent()).isEqualByComparingTo("5");
    assertThat(product.origin()).isEqualTo(CommissionRuleOrigin.TENANT_DEFAULT_PRODUCT);
  }

  @Test
  void versionsRespectEffectiveDatesAndClosedRules() {
    Instant t0 = Instant.parse("2026-01-01T00:00:00Z");
    Instant t1 = Instant.parse("2026-03-01T00:00:00Z");
    Instant t2 = Instant.parse("2026-05-01T00:00:00Z");
    var snapshot =
        new CommissionConfigSnapshot(
            List.of(
                v(CommissionConfigScope.RULE, 10L, null, "30.00", t0),
                v(CommissionConfigScope.RULE, 10L, null, "35.00", t1),
                v(CommissionConfigScope.RULE, 10L, null, null, t2),
                v(CommissionConfigScope.BASE, null, null, "TAX_INCLUDED", t1)));
    assertThat(
            snapshot
                .ruleAt(10L, null, Instant.parse("2026-02-01T00:00:00Z"))
                .get()
                .getConfigValue())
        .isEqualTo("30.00");
    assertThat(
            snapshot
                .ruleAt(10L, null, Instant.parse("2026-04-01T00:00:00Z"))
                .get()
                .getConfigValue())
        .isEqualTo("35.00");
    assertThat(snapshot.ruleAt(10L, null, Instant.parse("2026-06-01T00:00:00Z"))).isEmpty();
    assertThat(snapshot.baseAt(t0)).isEqualTo(CommissionBaseType.NET_OF_TAX);
    assertThat(snapshot.baseAt(t2)).isEqualTo(CommissionBaseType.TAX_INCLUDED);
    assertThat(snapshot.scheduledAfter(CommissionConfigSnapshot.ScopeKey.rule(10L, null), t1))
        .hasSize(1);
  }

  @Test
  void percentValidation() {
    assertThat(CommissionConfigService.parsePercent("40,5")).isEqualByComparingTo("40.5");
    org.assertj.core.api.Assertions.assertThatThrownBy(
            () -> CommissionConfigService.parsePercent("120"))
        .hasMessageContaining("COMMISSION_PERCENT_OUT_OF_RANGE");
    org.assertj.core.api.Assertions.assertThatThrownBy(
            () -> CommissionConfigService.parsePercent("10.123"))
        .hasMessageContaining("COMMISSION_PERCENT_OUT_OF_RANGE");
  }
}
