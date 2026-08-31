import { describe, expect, it } from "vitest";
import { displayToIso, isoToDisplay, maskDate } from "./DateField";

describe("DateField helpers (issue #174 AC-06)", () => {
  it("masks digits progressively as DD/MM/YYYY", () => {
    expect(maskDate("0")).toBe("0");
    expect(maskDate("07")).toBe("07");
    expect(maskDate("0703")).toBe("07/03");
    expect(maskDate("07032026")).toBe("07/03/2026");
    // strips non-digits and caps at 8 digits
    expect(maskDate("07/03/2026extra")).toBe("07/03/2026");
  });

  it("round-trips ISO <-> display", () => {
    expect(isoToDisplay("2026-03-07")).toBe("07/03/2026");
    expect(displayToIso("07/03/2026")).toBe("2026-03-07");
  });

  it("returns '' for incomplete or impossible dates", () => {
    expect(isoToDisplay("")).toBe("");
    expect(isoToDisplay("2026-3-7")).toBe("");
    expect(displayToIso("07/03")).toBe("");
    expect(displayToIso("32/01/2026")).toBe("");
    expect(displayToIso("29/02/2025")).toBe(""); // 2025 is not a leap year
    expect(displayToIso("29/02/2024")).toBe("2024-02-29");
  });
});
