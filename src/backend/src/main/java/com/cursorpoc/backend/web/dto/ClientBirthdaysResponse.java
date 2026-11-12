package com.cursorpoc.backend.web.dto;

import java.util.List;

/** HU-69: dashboard birthday alerts — today, and the next {@code upcomingDays} days. */
public record ClientBirthdaysResponse(
    List<Birthday> today, List<Birthday> upcoming, int upcomingDays) {

  /**
   * @param date ISO date (yyyy-MM-dd) of this year's celebration in the server zone
   * @param turningAge age the client turns that day, or null when the year is unknown
   */
  public record Birthday(
      long clientId, String fullName, String phone, String date, Integer turningAge) {}
}
