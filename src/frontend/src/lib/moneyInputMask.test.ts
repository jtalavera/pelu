import { describe, expect, it } from "vitest";
import { maskMoneyInput, moneyDigitsOnly, parseMaskedMoney } from "./moneyInputMask";

describe("moneyInputMask", () => {
  it.each([
    ["", ""],
    ["0", "0"],
    ["1", "1"],
    ["10", "10"],
    ["100", "100"],
    ["1000", "1.000"],
    ["10000", "10.000"],
    ["100000", "100.000"],
    ["1000000", "1.000.000"],
    ["1.234.567", "1.234.567"],
    ["1234abc567", "1.234.567"],
  ])("masks '%s' -> '%s'", (input, expected) => {
    expect(maskMoneyInput(input)).toBe(expected);
  });

  it.each([
    ["", 0],
    ["0", 0],
    ["1.000", 1000],
    ["1.234.567", 1234567],
    ["abc", 0],
    ["12 345", 12345],
  ])("parses '%s' -> %s", (input, expected) => {
    expect(parseMaskedMoney(input)).toBe(expected);
  });

  it("strips non-digits", () => {
    expect(moneyDigitsOnly("Gs. 1.234,56")).toBe("123456");
  });
});
