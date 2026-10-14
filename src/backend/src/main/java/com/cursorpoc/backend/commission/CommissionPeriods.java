package com.cursorpoc.backend.commission;

import com.cursorpoc.backend.domain.enums.CommissionPeriodicity;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.TemporalAdjusters;

/**
 * Fixed calendar settlement periods (§4.4, decision 4): weekly Monday–Sunday, biweekly 1–15 /
 * 16–end of month, monthly calendar month. MANUAL has no predefined period.
 */
public final class CommissionPeriods {

  private CommissionPeriods() {}

  /** An inclusive date range. */
  public record Period(LocalDate from, LocalDate to) {

    public Instant startInstant(ZoneId zone) {
      return from.atStartOfDay(zone).toInstant();
    }

    /** Exclusive end: 00:00 of the day after {@code to}. */
    public Instant endInstant(ZoneId zone) {
      return to.plusDays(1).atStartOfDay(zone).toInstant();
    }
  }

  /** The period containing {@code date}, or null for MANUAL. */
  public static Period periodContaining(CommissionPeriodicity periodicity, LocalDate date) {
    return switch (periodicity) {
      case WEEKLY -> {
        LocalDate monday = date.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        yield new Period(monday, monday.plusDays(6));
      }
      case BIWEEKLY ->
          date.getDayOfMonth() <= 15
              ? new Period(date.withDayOfMonth(1), date.withDayOfMonth(15))
              : new Period(date.withDayOfMonth(16), date.with(TemporalAdjusters.lastDayOfMonth()));
      case MONTHLY ->
          new Period(date.withDayOfMonth(1), date.with(TemporalAdjusters.lastDayOfMonth()));
      case MANUAL -> null;
    };
  }

  /** The period right after the one containing {@code date}, or null for MANUAL. */
  public static Period nextPeriod(CommissionPeriodicity periodicity, LocalDate date) {
    Period current = periodContaining(periodicity, date);
    return current == null ? null : periodContaining(periodicity, current.to().plusDays(1));
  }
}
