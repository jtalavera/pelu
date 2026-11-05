package com.cursorpoc.backend.service;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/**
 * The one-year ceiling of every date-range search (fichas, comprobantes, cajas, comisiones,
 * propinas, auditoría): nothing older than one year from today is ever returned.
 *
 * <p>A «from» older than the ceiling is rejected with {@value #TOO_OLD}; a missing «from» is
 * clamped to the ceiling. The rejection allows one day of tolerance because the browser sends its
 * own local midnight while the server (UTC) can already be a day ahead of the user's date.
 */
public final class SearchRangeLimits {

  public static final String TOO_OLD = "DATE_RANGE_TOO_OLD";
  public static final int MAX_YEARS = 1;

  private SearchRangeLimits() {}

  /** First day that may be searched: today, one year back. */
  public static LocalDate floorDate(ZoneId zone) {
    return LocalDate.now(zone).minusYears(MAX_YEARS);
  }

  public static Instant floorInstant(ZoneId zone) {
    return floorDate(zone).atStartOfDay(zone).toInstant();
  }

  /** «from» of a search: null becomes the ceiling; older than the ceiling (+1 day) is a 400. */
  public static Instant resolveFrom(Instant from, ZoneId zone, String errorCode) {
    if (from == null) {
      return floorInstant(zone);
    }
    if (from.isBefore(floorDate(zone).minusDays(1).atStartOfDay(zone).toInstant())) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, errorCode);
    }
    return from.isBefore(floorInstant(zone)) ? floorInstant(zone) : from;
  }

  public static LocalDate resolveFrom(LocalDate from, ZoneId zone, String errorCode) {
    if (from == null) {
      return floorDate(zone);
    }
    if (from.isBefore(floorDate(zone).minusDays(1))) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, errorCode);
    }
    return from.isBefore(floorDate(zone)) ? floorDate(zone) : from;
  }
}
