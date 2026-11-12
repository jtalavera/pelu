import { describe, expect, it } from "vitest";
import {
  FEMME_MONEY_LOCALE,
  formatAmountDecimal,
  formatDecimalGs,
  formatGuaraniesGs,
  formatIntegerGs,
} from "./formatMoney";

describe("formatMoney", () => {
  it("uses es-PY for money (thousands with period)", () => {
    expect(FEMME_MONEY_LOCALE).toBe("es-PY");
    expect(formatIntegerGs(1_234_567)).toBe("1.234.567");
    expect(formatGuaraniesGs(890_000)).toBe("Gs. 890.000");
  });

  it("formats money as integer (no decimals, rounded)", () => {
    expect(formatDecimalGs(12_345.6)).toBe("12.346");
    expect(formatAmountDecimal("100.5")).toBe("101");
  });
});

import { formatSignedGs } from "./formatMoney";

describe("formatSignedGs", () => {
  it("shows negatives with a true minus before Gs.", () => {
    expect(formatSignedGs(-6000)).toBe("−Gs. 6.000");
    expect(formatSignedGs("-100000")).toBe("−Gs. 100.000");
  });
  it("leaves positives plain, or with + when asked", () => {
    expect(formatSignedGs(10000)).toBe("Gs. 10.000");
    expect(formatSignedGs(10000, true)).toBe("+Gs. 10.000");
    expect(formatSignedGs(0, true)).toBe("Gs. 0");
  });
});
