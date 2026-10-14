package com.cursorpoc.backend.stock;

import static org.assertj.core.api.Assertions.assertThat;

import com.cursorpoc.backend.domain.StockOutboxEvent;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class StockOutboxMessagesTest {

  private final StockOutboxMessages messages =
      new StockOutboxMessages(JsonMapper.builder().build());

  @Test
  void appendsEntriesOldestFirstAndReadsThemBack() {
    StockOutboxEvent event = new StockOutboxEvent();
    Instant t0 = Instant.parse("2026-10-08T12:00:00Z");
    messages.append(event, StockOutboxMessages.INFO, "ENQUEUED", t0);
    messages.append(
        event,
        StockOutboxMessages.WARN,
        "ATTEMPT_FAILED_RETRY_SCHEDULED",
        StockOutboxMessages.params("attempt", 1, "reason", "TIMEOUT", "skipped", null),
        t0.plusSeconds(5));

    List<StockOutboxMessages.Entry> entries = messages.read(event);

    assertThat(entries)
        .extracting(StockOutboxMessages.Entry::code)
        .containsExactly("ENQUEUED", "ATTEMPT_FAILED_RETRY_SCHEDULED");
    assertThat(entries.get(0).at()).isEqualTo("2026-10-08T12:00:00Z");
    assertThat(entries.get(1).level()).isEqualTo("WARN");
    assertThat(entries.get(1).params())
        .containsEntry("attempt", 1)
        .containsEntry("reason", "TIMEOUT")
        .doesNotContainKey("skipped");
  }

  @Test
  void keepsTheFirstEntryAndTheMostRecentOnesWhenTheHistoryGrowsTooLong() {
    StockOutboxEvent event = new StockOutboxEvent();
    Instant t0 = Instant.parse("2026-10-08T12:00:00Z");
    messages.append(event, StockOutboxMessages.INFO, "ENQUEUED", t0);
    for (int i = 1; i <= StockOutboxMessages.MAX_ENTRIES + 10; i++) {
      messages.append(
          event,
          StockOutboxMessages.INFO,
          "ATTEMPT_STARTED",
          StockOutboxMessages.params("n", i),
          t0);
    }

    List<StockOutboxMessages.Entry> entries = messages.read(event);

    assertThat(entries).hasSize(StockOutboxMessages.MAX_ENTRIES);
    assertThat(entries.get(0).code()).isEqualTo("ENQUEUED");
    assertThat(entries.getLast().params()).containsEntry("n", StockOutboxMessages.MAX_ENTRIES + 10);
  }

  @Test
  void anUnreadableOrMissingHistoryReadsAsEmpty() {
    StockOutboxEvent event = new StockOutboxEvent();
    assertThat(messages.read(event)).isEmpty();
    event.setUserMessagesJson("not json");
    assertThat(messages.read(event)).isEmpty();
  }

  @Test
  void classifiesTechnicalErrorsIntoReasonCodes() {
    assertThat(StockOutboxMessages.reasonOf("STOCK_UNREACHABLE HttpTimeoutException"))
        .isEqualTo("TIMEOUT");
    assertThat(StockOutboxMessages.reasonOf("STOCK_UNREACHABLE HttpConnectTimeoutException"))
        .isEqualTo("TIMEOUT");
    assertThat(StockOutboxMessages.reasonOf("STOCK_UNREACHABLE ConnectException"))
        .isEqualTo("UNREACHABLE");
    assertThat(StockOutboxMessages.reasonOf("STOCK_NOT_CONFIGURED")).isEqualTo("NOT_CONFIGURED");
    assertThat(StockOutboxMessages.reasonOf("STOCK_TOKEN_REQUEST_FAILED status=401"))
        .isEqualTo("AUTH");
    assertThat(StockOutboxMessages.reasonOf("STOCK_TOKEN_REQUEST_FAILED status=503"))
        .isEqualTo("SERVER_ERROR");
    assertThat(StockOutboxMessages.reasonOf("UNEXPECTED_ERROR NullPointerException"))
        .isEqualTo("UNEXPECTED");
    assertThat(StockOutboxMessages.reasonOf("HTTP_503")).isEqualTo("SERVER_ERROR");
    assertThat(StockOutboxMessages.reasonOf("HTTP_401")).isEqualTo("AUTH");
    assertThat(StockOutboxMessages.reasonOf("HTTP_403 FORBIDDEN")).isEqualTo("AUTH");
    assertThat(StockOutboxMessages.reasonOf("HTTP_404 TENANT_NOT_PROVISIONED"))
        .isEqualTo("NOT_FOUND");
    assertThat(StockOutboxMessages.reasonOf("HTTP_408")).isEqualTo("TIMEOUT");
    assertThat(StockOutboxMessages.reasonOf("HTTP_429")).isEqualTo("THROTTLED");
    assertThat(StockOutboxMessages.reasonOf("HTTP_400 INVALID_ITEM [batch 2/5]"))
        .isEqualTo("REJECTED");
    assertThat(StockOutboxMessages.reasonOf(null)).isEqualTo("UNKNOWN");
    assertThat(StockOutboxMessages.reasonOf("???")).isEqualTo("UNKNOWN");
  }
}
