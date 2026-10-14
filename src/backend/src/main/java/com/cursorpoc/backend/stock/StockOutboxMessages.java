package com.cursorpoc.backend.stock;

import com.cursorpoc.backend.domain.StockOutboxEvent;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

/**
 * Stock integration: the per-delivery history shown to the support user. Each entry is a
 * language-neutral code plus parameters (never English prose — the frontend translates {@code
 * femme.platform.stock.msg.<CODE>}), stored as a JSON array in {@code
 * stock_outbox.user_messages_json}, oldest first.
 *
 * <p>Codes: {@code ENQUEUED}, {@code ATTEMPT_STARTED}, {@code LEASE_EXPIRED_RECLAIMED}, {@code
 * ATTEMPT_RELEASED}, {@code DELIVERED}, {@code ATTEMPT_FAILED_RETRY_SCHEDULED}, {@code
 * ATTEMPT_FAILED_NO_MORE_RETRIES}, {@code ATTEMPT_FAILED_NOT_RETRYABLE}, {@code
 * RETRY_REQUESTED_NOW}, {@code RETRY_REQUESTED_AFTER_FAILURE}, {@code DISCARDED_MANUALLY}, {@code
 * SUPERSEDED}.
 */
@Component
public class StockOutboxMessages {

  private static final Logger log = LoggerFactory.getLogger(StockOutboxMessages.class);

  public static final String INFO = "INFO";
  public static final String WARN = "WARN";
  public static final String ERROR = "ERROR";

  /** The first entry (when it was queued) and the most recent ones are kept. */
  static final int MAX_ENTRIES = 60;

  private static final TypeReference<List<Entry>> ENTRIES_TYPE = new TypeReference<>() {};

  /** One history line. {@code at} is an ISO-8601 UTC instant. */
  public record Entry(String at, String level, String code, Map<String, Object> params) {}

  private final ObjectMapper objectMapper;

  public StockOutboxMessages(ObjectMapper objectMapper) {
    this.objectMapper = objectMapper;
  }

  public void append(
      StockOutboxEvent event, String level, String code, Map<String, Object> params, Instant now) {
    List<Entry> entries = new ArrayList<>(read(event));
    entries.add(new Entry(now.toString(), level, code, params == null ? Map.of() : params));
    while (entries.size() > MAX_ENTRIES) {
      entries.remove(1);
    }
    event.setUserMessagesJson(objectMapper.writeValueAsString(entries));
  }

  public void append(StockOutboxEvent event, String level, String code, Instant now) {
    append(event, level, code, Map.of(), now);
  }

  /** Never throws: an unreadable history shows as empty rather than breaking the panel. */
  public List<Entry> read(StockOutboxEvent event) {
    String json = event.getUserMessagesJson();
    if (json == null || json.isBlank()) {
      return List.of();
    }
    try {
      return objectMapper.readValue(json, ENTRIES_TYPE);
    } catch (RuntimeException e) {
      log.warn("Stock outbox eventId={} has an unreadable message history", event.getId());
      return List.of();
    }
  }

  /** Builds an ordered params map from alternating key/value arguments. */
  public static Map<String, Object> params(Object... keyValues) {
    Map<String, Object> map = new LinkedHashMap<>();
    for (int i = 0; i + 1 < keyValues.length; i += 2) {
      if (keyValues[i + 1] != null) {
        map.put(String.valueOf(keyValues[i]), keyValues[i + 1]);
      }
    }
    return map;
  }

  /**
   * Maps the technical error string stored in {@code last_error} (e.g. {@code STOCK_UNREACHABLE
   * HttpTimeoutException}, {@code HTTP_503}) to a stable reason code the frontend explains in plain
   * words ({@code femme.platform.stock.reason.<CODE>}).
   */
  public static String reasonOf(String error) {
    if (error == null || error.isBlank()) {
      return "UNKNOWN";
    }
    if (error.startsWith("STOCK_UNREACHABLE")) {
      return error.contains("Timeout") ? "TIMEOUT" : "UNREACHABLE";
    }
    if (error.startsWith("STOCK_NOT_CONFIGURED")) {
      return "NOT_CONFIGURED";
    }
    if (error.startsWith("STOCK_TOKEN_REQUEST_FAILED")) {
      // "...status=503": Stock itself is down; anything else means the credentials were refused.
      int at = error.indexOf("status=");
      return at >= 0 && httpStatus(error, at + 7) >= 500 ? "SERVER_ERROR" : "AUTH";
    }
    if (error.startsWith("UNEXPECTED_ERROR")) {
      return "UNEXPECTED";
    }
    if (error.startsWith("HTTP_")) {
      int status = httpStatus(error, 5);
      if (status == 401 || status == 403) {
        return "AUTH";
      }
      if (status == 429) {
        return "THROTTLED";
      }
      if (status == 408) {
        return "TIMEOUT";
      }
      if (status >= 500) {
        return "SERVER_ERROR";
      }
      if (status == 404) {
        return "NOT_FOUND";
      }
      if (status >= 400) {
        return "REJECTED";
      }
    }
    return "UNKNOWN";
  }

  private static int httpStatus(String error, int from) {
    int end = from;
    while (end < error.length() && Character.isDigit(error.charAt(end))) {
      end++;
    }
    try {
      return Integer.parseInt(error.substring(from, end));
    } catch (NumberFormatException e) {
      return 0;
    }
  }
}
