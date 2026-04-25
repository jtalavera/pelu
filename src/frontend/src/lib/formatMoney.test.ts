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

  it("formats decimals with comma as fraction separator", () => {
    expect(formatDecimalGs(12_345.6)).toBe("12.345,60");
    expect(formatAmountDecimal("100.5")).toBe("100,50");
  });
});
