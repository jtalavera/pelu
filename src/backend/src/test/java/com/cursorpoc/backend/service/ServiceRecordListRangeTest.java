package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class ServiceRecordListRangeTest {

  private final ZoneId z = ZoneId.systemDefault();

  @Test
  void acceptsTheSixMonthLimitEvenWhenTheUsersDayIsOneBehindTheServers() {
    LocalDate limit = LocalDate.now(z).minusMonths(ServiceRecordService.MAX_LIST_MONTHS);
    Instant to = LocalDate.now(z).atTime(23, 59, 59).atZone(z).toInstant();
    Instant userMidnight = limit.minusDays(1).atStartOfDay(z).toInstant();
    assertThat(ServiceRecordService.resolveListRange(userMidnight, to)).hasSize(2);
  }

  @Test
  void rejectsFromDatesOlderThanTheToleratedLimit() {
    LocalDate limit = LocalDate.now(z).minusMonths(ServiceRecordService.MAX_LIST_MONTHS);
    Instant to = LocalDate.now(z).atTime(23, 59, 59).atZone(z).toInstant();
    Instant tooOld = limit.minusDays(2).atStartOfDay(z).toInstant();
    assertThatThrownBy(() -> ServiceRecordService.resolveListRange(tooOld, to))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SERVICE_RECORD_LIST_RANGE_TOO_OLD");
  }
}
