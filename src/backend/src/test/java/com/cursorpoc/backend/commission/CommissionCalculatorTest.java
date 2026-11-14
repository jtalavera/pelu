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

  // ── HU-COM-12: reglas del salón (precio con IVA, retención de aguinaldo, monto fijo) ──────────

  private static final Instant NOW = Instant.parse("2026-11-14T12:00:00Z");
  private static final Instant EARLIER = NOW.minusSeconds(3600);

  private static CommissionConfigVersion group(
      long groupId, Long professionalId, String value, Instant from) {
    CommissionConfigVersion v =
        v(CommissionConfigScope.GROUP_RULE, null, professionalId, value, from);
    v.setGroupId(groupId);
    return v;
  }

  private static CommissionConfigSnapshot salon(CommissionConfigVersion... rules) {
    java.util.List<CommissionConfigVersion> all = new java.util.ArrayList<>(List.of(rules));
    all.add(v(CommissionConfigScope.AGUINALDO_ENABLED, null, null, "true", EARLIER));
    return new CommissionConfigSnapshot(all);
  }

  private static CommissionCalculator.LineAmounts line(
      CommissionConfigSnapshot snap, long group, Long pro, String price) {
    CommissionCalculator.Resolution r =
        CommissionCalculator.resolve(snap, 1L, group, ServiceKind.SERVICE, pro, NOW);
    return CommissionCalculator.amounts(
        new BigDecimal(price), BigDecimal.ZERO, CommissionBaseType.TAX_INCLUDED, r);
  }

  @Test
  void brushingPaysFortyFiveAndRetainsFive() {
    CommissionConfigSnapshot snap = salon(group(10, 7L, "45|5|0|", EARLIER));
    CommissionCalculator.LineAmounts a = line(snap, 10, 7L, "100000");
    assertThat(a.commissionAmount()).isEqualByComparingTo("45000");
    assertThat(a.retentionAmount()).isEqualByComparingTo("5000");
    assertThat(a.fixedAmount()).isEqualByComparingTo("0");
  }

  @Test
  void eyelashesFixedAmountIsPaidToTheProfessionalOnTopOfTheCommission() {
    // 30.000 servicio + 20.000 pestaña: comisiona solo sobre los 30.000; los 20.000 son de Gaby.
    CommissionConfigSnapshot snap = salon(group(10, 7L, "45|5|20000|P", EARLIER));
    CommissionCalculator.LineAmounts a = line(snap, 10, 7L, "50000");
    assertThat(a.baseAmount()).isEqualByComparingTo("30000");
    assertThat(a.percentAmount()).isEqualByComparingTo("13500");
    assertThat(a.retentionAmount()).isEqualByComparingTo("1500"); // no se retiene sobre el fijo
    assertThat(a.commissionAmount()).isEqualByComparingTo("33500");
    assertThat(a.fixedToProfessional()).isTrue();
  }

  @Test
  void aFixedAmountForTheSalonOnlyLowersTheBase() {
    CommissionConfigSnapshot snap = salon(group(10, 7L, "45|5|3000|S", EARLIER));
    CommissionCalculator.LineAmounts a = line(snap, 10, 7L, "50000");
    assertThat(a.baseAmount()).isEqualByComparingTo("47000");
    assertThat(a.commissionAmount()).isEqualByComparingTo("21150");
    assertThat(a.retentionAmount()).isEqualByComparingTo("2350");
    assertThat(a.fixedToProfessional()).isFalse();
  }

  @Test
  void theSalonDefaultDestinationAppliesWhenTheRuleDoesNotSetOne() {
    java.util.List<CommissionConfigVersion> all = new java.util.ArrayList<>();
    all.add(group(10, 7L, "50|0|3000|", EARLIER));
    all.add(v(CommissionConfigScope.FIXED_DESTINATION, null, null, "SALON", EARLIER));
    CommissionConfigSnapshot snap = new CommissionConfigSnapshot(all);
    assertThat(line(snap, 10, 7L, "50000").commissionAmount()).isEqualByComparingTo("23500");
    all.set(1, v(CommissionConfigScope.FIXED_DESTINATION, null, null, "PROFESSIONAL", EARLIER));
    assertThat(line(new CommissionConfigSnapshot(all), 10, 7L, "50000").commissionAmount())
        .isEqualByComparingTo("26500"); // Jorgelina: 3.000 + 50 % de 47.000
  }

  @Test
  void withoutRetentionEnabledNothingIsRetained() {
    CommissionConfigSnapshot snap =
        new CommissionConfigSnapshot(List.of(group(10, 7L, "45|5|0|", EARLIER)));
    CommissionCalculator.LineAmounts a = line(snap, 10, 7L, "100000");
    assertThat(a.retentionAmount()).isEqualByComparingTo("0");
    assertThat(a.commissionAmount()).isEqualByComparingTo("45000");
  }

  @Test
  void aFixedAmountBiggerThanThePriceLeavesAZeroBaseButIsStillPaid() {
    CommissionConfigSnapshot snap = salon(group(10, 7L, "45|5|20000|P", EARLIER));
    CommissionCalculator.LineAmounts a = line(snap, 10, 7L, "15000");
    assertThat(a.baseAmount()).isEqualByComparingTo("0");
    assertThat(a.commissionAmount()).isEqualByComparingTo("20000");
    assertThat(a.retentionAmount()).isEqualByComparingTo("0");
    // A free (0 price) line gets nothing, not even the fixed amount.
    assertThat(line(snap, 10, 7L, "0").commissionAmount()).isEqualByComparingTo("0");
  }

  @Test
  void precedenceGoesFromTheMostSpecificToTheDefault() {
    CommissionConfigSnapshot snap =
        salon(
            v(CommissionConfigScope.RULE, 1L, 7L, "70", EARLIER),
            group(10, 7L, "45|5|0|", EARLIER),
            v(CommissionConfigScope.RULE, 1L, null, "40", EARLIER),
            group(10, null, "30", EARLIER),
            v(CommissionConfigScope.DEFAULT_SERVICE, null, null, "20", EARLIER));
    assertThat(CommissionCalculator.resolve(snap, 1L, 10L, ServiceKind.SERVICE, 7L, NOW).origin())
        .isEqualTo(CommissionRuleOrigin.BENEFICIARY_ITEM);
    // Without the professional + item exception: professional + group.
    CommissionConfigSnapshot noException =
        salon(
            group(10, 7L, "45|5|0|", EARLIER),
            v(CommissionConfigScope.RULE, 1L, null, "40", EARLIER),
            group(10, null, "30", EARLIER));
    assertThat(
            CommissionCalculator.resolve(noException, 1L, 10L, ServiceKind.SERVICE, 7L, NOW)
                .origin())
        .isEqualTo(CommissionRuleOrigin.BENEFICIARY_GROUP);
    // Another professional: the item rule for everyone, then the group rule for everyone.
    assertThat(
            CommissionCalculator.resolve(noException, 1L, 10L, ServiceKind.SERVICE, 8L, NOW)
                .origin())
        .isEqualTo(CommissionRuleOrigin.ITEM);
    CommissionConfigSnapshot groupOnly = salon(group(10, null, "30", EARLIER));
    assertThat(
            CommissionCalculator.resolve(groupOnly, 1L, 10L, ServiceKind.SERVICE, 8L, NOW).origin())
        .isEqualTo(CommissionRuleOrigin.GROUP);
    CommissionConfigSnapshot onlyDefault =
        salon(v(CommissionConfigScope.DEFAULT_SERVICE, null, null, "20", EARLIER));
    CommissionCalculator.Resolution r =
        CommissionCalculator.resolve(onlyDefault, 1L, 10L, ServiceKind.SERVICE, 8L, NOW);
    assertThat(r.origin()).isEqualTo(CommissionRuleOrigin.TENANT_DEFAULT_SERVICE);
    assertThat(r.percent()).isEqualByComparingTo("20");
  }

  @Test
  void salonCasesAreCalculatedAsAgreed() {
    // Migue · Manos: 50.000 → 3.000 de producto para ella + 45 % y 5 % de 47.000.
    CommissionConfigSnapshot migue = salon(group(10, 7L, "45|5|3000|P", EARLIER));
    CommissionCalculator.LineAmounts m = line(migue, 10, 7L, "50000");
    assertThat(m.commissionAmount()).isEqualByComparingTo("24150");
    assertThat(m.retentionAmount()).isEqualByComparingTo("2350");
    // Jorgelina · Manos: sin retención.
    CommissionConfigSnapshot jorgelina = salon(group(10, 8L, "50|0|3000|P", EARLIER));
    assertThat(line(jorgelina, 10, 8L, "50000").commissionAmount()).isEqualByComparingTo("26500");
    // Aracely · producto: 5 % + 5 %.
    CommissionConfigSnapshot aracely = salon(group(11, 9L, "5|5|0|", EARLIER));
    CommissionCalculator.LineAmounts p = line(aracely, 11, 9L, "80000");
    assertThat(p.commissionAmount()).isEqualByComparingTo("4000");
    assertThat(p.retentionAmount()).isEqualByComparingTo("4000");
    // Myriam · Tratamiento 30 % sin retención.
    CommissionConfigSnapshot myriam = salon(group(12, 10L, "30", EARLIER));
    CommissionCalculator.LineAmounts t = line(myriam, 12, 10L, "80000");
    assertThat(t.commissionAmount()).isEqualByComparingTo("24000");
    assertThat(t.retentionAmount()).isEqualByComparingTo("0");
  }
}
