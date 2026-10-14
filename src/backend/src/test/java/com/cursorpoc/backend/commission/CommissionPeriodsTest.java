package com.cursorpoc.backend.commission;

import static org.assertj.core.api.Assertions.assertThat;

import com.cursorpoc.backend.domain.enums.CommissionPeriodicity;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;

class CommissionPeriodsTest {

  @Test
  void weeklyRunsMondayToSunday() {
    var p =
        CommissionPeriods.periodContaining(
            CommissionPeriodicity.WEEKLY, LocalDate.of(2026, 10, 15));
    assertThat(p.from()).isEqualTo(LocalDate.of(2026, 10, 12));
    assertThat(p.to()).isEqualTo(LocalDate.of(2026, 10, 18));
    assertThat(
            CommissionPeriods.nextPeriod(CommissionPeriodicity.WEEKLY, LocalDate.of(2026, 10, 18))
                .from())
        .isEqualTo(LocalDate.of(2026, 10, 19));
  }

  @Test
  void biweeklySplitsOnThe15th() {
    var first =
        CommissionPeriods.periodContaining(
            CommissionPeriodicity.BIWEEKLY, LocalDate.of(2026, 2, 15));
    assertThat(first.from()).isEqualTo(LocalDate.of(2026, 2, 1));
    assertThat(first.to()).isEqualTo(LocalDate.of(2026, 2, 15));
    var second =
        CommissionPeriods.periodContaining(
            CommissionPeriodicity.BIWEEKLY, LocalDate.of(2026, 2, 16));
    assertThat(second.to()).isEqualTo(LocalDate.of(2026, 2, 28));
    assertThat(
            CommissionPeriods.nextPeriod(CommissionPeriodicity.BIWEEKLY, LocalDate.of(2026, 2, 20))
                .from())
        .isEqualTo(LocalDate.of(2026, 3, 1));
  }

  @Test
  void monthlyIsTheCalendarMonthAndManualHasNoPeriod() {
    var p =
        CommissionPeriods.periodContaining(
            CommissionPeriodicity.MONTHLY, LocalDate.of(2026, 12, 31));
    assertThat(p.from()).isEqualTo(LocalDate.of(2026, 12, 1));
    assertThat(
            CommissionPeriods.nextPeriod(CommissionPeriodicity.MONTHLY, LocalDate.of(2026, 12, 31))
                .from())
        .isEqualTo(LocalDate.of(2027, 1, 1));
    assertThat(CommissionPeriods.periodContaining(CommissionPeriodicity.MANUAL, LocalDate.now()))
        .isNull();
  }
}
