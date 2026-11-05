import { describe, expect, it } from "vitest";
import { defaultSearchRange, isFromOlderThanOneYear, oneMonthAgoYmd } from "./dateRange";

describe("oneMonthAgoYmd", () => {
  it("goes back one calendar month on the same day", () => {
    expect(oneMonthAgoYmd(new Date(2026, 10, 4))).toBe("2026-10-04");
    expect(oneMonthAgoYmd(new Date(2026, 0, 15))).toBe("2025-12-15");
  });

  it("clamps to the last day of a shorter month", () => {
    expect(oneMonthAgoYmd(new Date(2026, 2, 31))).toBe("2026-02-28");
    expect(oneMonthAgoYmd(new Date(2028, 2, 31))).toBe("2028-02-29");
    expect(oneMonthAgoYmd(new Date(2026, 4, 31))).toBe("2026-04-30");
  });

  it("defaultSearchRange is one month back through today", () => {
    expect(defaultSearchRange(new Date(2026, 10, 4))).toEqual({ from: "2026-10-04", to: "2026-11-04" });
  });
});

describe("isFromOlderThanOneYear", () => {
  const now = new Date(2026, 10, 4);
  it("accepts exactly one year back and anything newer", () => {
    expect(isFromOlderThanOneYear("2025-11-04", now)).toBe(false);
    expect(isFromOlderThanOneYear("2026-05-04", now)).toBe(false);
  });
  it("rejects anything older than one year", () => {
    expect(isFromOlderThanOneYear("2025-11-03", now)).toBe(true);
    expect(isFromOlderThanOneYear("2024-01-01", now)).toBe(true);
  });
});
