import { describe, expect, it } from "vitest";
import { isValidParaguayRuc } from "./paraguayRuc";

describe("paraguayRuc", () => {
  it("accepts digit-hyphen-digit pattern", () => {
    expect(isValidParaguayRuc("80000005-6")).toBe(true);
    expect(isValidParaguayRuc("80000005-5")).toBe(true);
    expect(isValidParaguayRuc("1-2")).toBe(true);
  });

  it("rejects missing hyphen or non-digits", () => {
    expect(isValidParaguayRuc("80000005")).toBe(false);
    expect(isValidParaguayRuc("abc-1")).toBe(false);
    expect(isValidParaguayRuc("")).toBe(false);
  });
});
