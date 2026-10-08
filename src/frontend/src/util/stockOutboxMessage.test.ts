import { describe, expect, it } from "vitest";
import i18n from "../i18n";
import { formatStockOutboxMessage, isStockOutboxActionable } from "./stockOutboxMessage";

const fmt = (iso: string | null) => (iso ? `<${iso}>` : "—");

describe("formatStockOutboxMessage", () => {
  it.each(["en", "es"])("has text for every code the backend writes (%s)", async (lng) => {
    await i18n.changeLanguage(lng);
    const t = i18n.getFixedT(lng);
    const codes = [
      "ENQUEUED",
      "ATTEMPT_STARTED",
      "LEASE_EXPIRED_RECLAIMED",
      "ATTEMPT_RELEASED",
      "DELIVERED",
      "ATTEMPT_FAILED_RETRY_SCHEDULED",
      "ATTEMPT_FAILED_NO_MORE_RETRIES",
      "ATTEMPT_FAILED_NOT_RETRYABLE",
      "RETRY_REQUESTED_NOW",
      "RETRY_REQUESTED_AFTER_FAILURE",
      "DISCARDED_MANUALLY",
      "SUPERSEDED",
    ];
    for (const code of codes) {
      const text = formatStockOutboxMessage(t, fmt, {
        at: "2026-10-08T12:00:00Z",
        level: "INFO",
        code,
        params: { attempt: 1, maxAttempts: 7, reason: "TIMEOUT", byEventId: 5 },
      });
      expect(text, code).not.toBe(code);
      expect(text, code).not.toContain("{{");
    }
    for (const reason of [
      "TIMEOUT",
      "UNREACHABLE",
      "SERVER_ERROR",
      "AUTH",
      "THROTTLED",
      "NOT_FOUND",
      "REJECTED",
      "NOT_CONFIGURED",
      "UNEXPECTED",
      "UNKNOWN",
    ]) {
      expect(i18n.exists(`femme.platform.stock.reason.${reason}`, { lng }), reason).toBe(true);
    }
  });

  it("fills in the attempt, the reason in plain words and the formatted next attempt", async () => {
    await i18n.changeLanguage("en");
    const text = formatStockOutboxMessage(i18n.getFixedT("en"), fmt, {
      at: "2026-10-08T12:00:00Z",
      level: "WARN",
      code: "ATTEMPT_FAILED_RETRY_SCHEDULED",
      params: {
        attempt: 2,
        maxAttempts: 7,
        reason: "SERVER_ERROR",
        nextAttemptAt: "2026-10-08T12:05:00Z",
      },
    });
    expect(text).toBe(
      "Attempt 2 of 7 failed: Stock had an internal error. Femme will try again on <2026-10-08T12:05:00Z>.",
    );
  });

  it("uses the catalog variant when a delivery reports item counts", async () => {
    await i18n.changeLanguage("en");
    const text = formatStockOutboxMessage(i18n.getFixedT("en"), fmt, {
      at: "2026-10-08T12:00:00Z",
      level: "INFO",
      code: "DELIVERED",
      params: { attempt: 3, items: 450, batches: 3 },
    });
    expect(text).toBe("Delivered to Stock on attempt 3: 450 item(s) in 3 batch(es).");
  });

  it("falls back to the unknown reason for a reason the UI does not know", async () => {
    await i18n.changeLanguage("en");
    const text = formatStockOutboxMessage(i18n.getFixedT("en"), fmt, {
      at: "2026-10-08T12:00:00Z",
      level: "ERROR",
      code: "ATTEMPT_FAILED_NOT_RETRYABLE",
      params: { attempt: 1, reason: "SOMETHING_NEW" },
    });
    expect(text).toContain("unknown error");
  });
});

describe("isStockOutboxActionable", () => {
  it("is true for failed rows and for pending rows that already failed an attempt", () => {
    expect(isStockOutboxActionable({ status: "FAILED", attemptCount: 3 })).toBe(true);
    expect(isStockOutboxActionable({ status: "PENDING", attemptCount: 2 })).toBe(true);
    expect(isStockOutboxActionable({ status: "PENDING", attemptCount: 0 })).toBe(false);
    expect(isStockOutboxActionable({ status: "PROCESSING", attemptCount: 1 })).toBe(false);
    expect(isStockOutboxActionable({ status: "DONE", attemptCount: 1 })).toBe(false);
  });
});
