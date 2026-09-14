import { describe, expect, it } from "vitest";
import {
  formatParaguayDate,
  formatParaguayDateTime,
  formatParaguayTime,
  PARAGUAY_TIMEZONE,
  zonedDateTimeToUtcMs,
  zonedYmd,
} from "./paraguayDateTime";

/**
 * 2026-04-30T20:30:00Z → in Paraguay (UTC-3) it's 2026-04-30 17:30.
 */
describe("paraguayDateTime", () => {
  const utc = "2026-04-30T20:30:00Z";

  it("formats date+time anchored to Asuncion (Spanish, dd/MM)", () => {
    expect(formatParaguayDateTime(utc, "es-PY")).toBe("30/04/2026, 17:30");
  });

  it("formats date+time anchored to Asuncion (English, MM/dd)", () => {
    expect(formatParaguayDateTime(utc, "en-US")).toBe("04/30/2026, 17:30");
  });

  it("formats date only", () => {
    expect(formatParaguayDate(utc, "es-PY")).toBe("30/04/2026");
  });

  it("formats time only", () => {
    expect(formatParaguayTime(utc, "es-PY")).toBe("17:30");
  });

  it("crossing midnight UTC stays on previous day in Asuncion", () => {
    // 2026-05-01T02:00:00Z is 2026-04-30 23:00 in Asuncion.
    const v = "2026-05-01T02:00:00Z";
    expect(formatParaguayDate(v, "es-PY")).toBe("30/04/2026");
    expect(formatParaguayTime(v, "es-PY")).toBe("23:00");
  });

  describe("zonedYmd", () => {
    it("reads the calendar day as observed in the given timezone, not UTC", () => {
      // 2026-05-01T02:00:00Z is still 2026-04-30 in Asuncion (UTC-3).
      const v = new Date("2026-05-01T02:00:00Z");
      expect(zonedYmd(v, PARAGUAY_TIMEZONE)).toEqual({ y: 2026, m: 4, d: 30 });
      // But it's already 2026-05-01 in UTC.
      expect(zonedYmd(v, "UTC")).toEqual({ y: 2026, m: 5, d: 1 });
    });
  });

  describe("zonedDateTimeToUtcMs", () => {
    it("converts wall-clock components in the given timezone to the UTC instant they denote", () => {
      // 2026-04-30 00:00:00.000 in Asuncion (UTC-3) is 2026-04-30T03:00:00.000Z.
      const ms = zonedDateTimeToUtcMs(2026, 4, 30, 0, 0, 0, 0, PARAGUAY_TIMEZONE);
      expect(new Date(ms).toISOString()).toBe("2026-04-30T03:00:00.000Z");
    });

    it("round-trips end-of-day back to the correct next-day UTC instant", () => {
      // 2026-04-30 23:59:59.999 in Asuncion is 2026-05-01T02:59:59.999Z.
      const ms = zonedDateTimeToUtcMs(2026, 4, 30, 23, 59, 59, 999, PARAGUAY_TIMEZONE);
      expect(new Date(ms).toISOString()).toBe("2026-05-01T02:59:59.999Z");
    });
  });
});
