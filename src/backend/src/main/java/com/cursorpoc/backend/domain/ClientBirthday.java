package com.cursorpoc.backend.domain;

import java.time.LocalDate;
import java.time.MonthDay;
import java.time.Year;

/** HU-69: birthday rules shared by validation, the dashboard alerts and the calendar icon. */
public final class ClientBirthday {

  /** Oldest accepted birth year — anything earlier is a typo, not a client. */
  public static final int MIN_YEAR = 1900;

  private ClientBirthday() {}

  /**
   * Day and month must come together; the year is optional, never in the future, and the date must
   * exist (29/02 only with a leap year, or without year).
   */
  public static boolean isValid(Integer day, Integer month, Integer year, LocalDate today) {
    if (day == null && month == null) {
      return year == null;
    }
    if (day == null || month == null || month < 1 || month > 12 || day < 1) {
      return false;
    }
    if (year != null) {
      if (year < MIN_YEAR || year > today.getYear()) return false;
      if (day > java.time.YearMonth.of(year, month).lengthOfMonth()) return false;
      return !LocalDate.of(year, month, day).isAfter(today);
    }
    // No year: any day that exists in some year (29/02 included).
    return day <= java.time.Month.of(month).maxLength();
  }

  /** The day this birthday is celebrated in {@code year} — 29/02 falls on 28/02 in common years. */
  public static LocalDate occurrenceIn(int day, int month, int year) {
    if (month == 2 && day == 29 && !Year.isLeap(year)) {
      return LocalDate.of(year, 2, 28);
    }
    return MonthDay.of(month, day).atYear(year);
  }

  public static boolean isBirthdayOn(Integer day, Integer month, LocalDate date) {
    if (day == null || month == null) return false;
    return occurrenceIn(day, month, date.getYear()).equals(date);
  }

  /** Next celebration on or after {@code from}. */
  public static LocalDate nextOccurrence(int day, int month, LocalDate from) {
    LocalDate thisYear = occurrenceIn(day, month, from.getYear());
    return thisYear.isBefore(from) ? occurrenceIn(day, month, from.getYear() + 1) : thisYear;
  }
}
