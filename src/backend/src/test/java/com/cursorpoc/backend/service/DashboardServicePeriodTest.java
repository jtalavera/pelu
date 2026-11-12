package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/**
 * Resumen redesign: the periods the dashboard can be asked for ({@code GET /api/dashboard?days=}).
 */
class DashboardServicePeriodTest {

  @Test
  void onlySevenThirtyAndNinetyDaysAreAllowedPeriods() {
    assertThat(DashboardService.isAllowedPeriod(7)).isTrue();
    assertThat(DashboardService.isAllowedPeriod(30)).isTrue();
    assertThat(DashboardService.isAllowedPeriod(90)).isTrue();
    assertThat(DashboardService.isAllowedPeriod(0)).isFalse();
    assertThat(DashboardService.isAllowedPeriod(15)).isFalse();
    assertThat(DashboardService.isAllowedPeriod(365)).isFalse();
  }

  @Test
  void theDefaultPeriodIsThirtyDays() {
    assertThat(DashboardService.REVENUE_TREND_DAYS).isEqualTo(30);
    assertThat(DashboardService.ALLOWED_PERIOD_DAYS).contains(DashboardService.REVENUE_TREND_DAYS);
  }
}
