import { describe, expect, it } from "vitest";
import { computeParaguayRucVerificationDigit, isValidParaguayRuc } from "./paraguayRuc";

describe("paraguayRuc", () => {
  it("accepts known valid RUC", () => {
    expect(isValidParaguayRuc("80000005-6")).toBe(true);
  });

  it("rejects wrong check digit", () => {
    expect(isValidParaguayRuc("80000005-5")).toBe(false);
  });

  it("rejects bad format", () => {
    expect(isValidParaguayRuc("80000005")).toBe(false);
    expect(isValidParaguayRuc("")).toBe(false);
  });

  it("computeDigit matches backend sample", () => {
    expect(computeParaguayRucVerificationDigit("80000005")).toBe(6);
  });
});
