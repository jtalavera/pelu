import { describe, expect, it } from "vitest";
import {
  formatParaguayDate,
  formatParaguayDateTime,
  formatParaguayTime,
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
});
