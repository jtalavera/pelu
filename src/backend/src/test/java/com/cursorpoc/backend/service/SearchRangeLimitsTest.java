package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.LocalDate;
import java.time.ZoneId;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class SearchRangeLimitsTest {

  private final ZoneId z = ZoneId.systemDefault();

  @Test
  void aMissingFromBecomesTheOneYearCeiling() {
    assertThat(SearchRangeLimits.resolveFrom((LocalDate) null, z, "X"))
        .isEqualTo(LocalDate.now(z).minusYears(1));
    assertThat(SearchRangeLimits.resolveFrom((java.time.Instant) null, z, "X"))
        .isEqualTo(LocalDate.now(z).minusYears(1).atStartOfDay(z).toInstant());
  }

  @Test
  void aFromInsideTheYearIsKept() {
    LocalDate from = LocalDate.now(z).minusMonths(3);
    assertThat(SearchRangeLimits.resolveFrom(from, z, "X")).isEqualTo(from);
  }

  @Test
  void aFromOneDayBeforeTheCeilingIsToleratedButClampedToIt() {
    LocalDate floor = LocalDate.now(z).minusYears(1);
    assertThat(SearchRangeLimits.resolveFrom(floor.minusDays(1), z, "X")).isEqualTo(floor);
  }

  @Test
  void aFromOlderThanTheYearIsRejectedWithTheGivenCode() {
    LocalDate tooOld = LocalDate.now(z).minusYears(1).minusDays(2);
    assertThatThrownBy(() -> SearchRangeLimits.resolveFrom(tooOld, z, "MY_CODE"))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("MY_CODE");
    assertThatThrownBy(
            () ->
                SearchRangeLimits.resolveFrom(
                    tooOld.atStartOfDay(z).toInstant(), z, SearchRangeLimits.TOO_OLD))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("DATE_RANGE_TOO_OLD");
  }
}
