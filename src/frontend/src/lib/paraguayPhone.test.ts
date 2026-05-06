import { describe, expect, it } from "vitest";
import {
  digitsOnly,
  formatParaguayPhone,
  isCompleteParaguayPhone,
} from "./paraguayPhone";

describe("digitsOnly", () => {
  it("strips spaces, parens, and hyphens", () => {
    expect(digitsOnly("(0981) 123-456")).toBe("0981123456");
  });

  it("returns empty for null-ish", () => {
    expect(digitsOnly("")).toBe("");
  });
});

describe("formatParaguayPhone", () => {
  it.each([
    ["", ""],
    ["0", "(0"],
    ["09", "(09"],
    ["098", "(098"],
    ["0981", "(0981"],
    ["09811", "(0981) 1"],
    ["0981123", "(0981) 123"],
    ["09811234", "(0981) 123-4"],
    ["098112345", "(0981) 123-45"],
    ["0981123456", "(0981) 123-456"],
  ])("formats %s -> %s", (input, expected) => {
    expect(formatParaguayPhone(input)).toBe(expected);
  });

  it("ignores characters past 10 digits", () => {
    expect(formatParaguayPhone("09811234567890")).toBe("(0981) 123-456");
  });

  it("ignores non-digits already present", () => {
    expect(formatParaguayPhone("(0981) 123-456 ext 12")).toBe("(0981) 123-456");
  });
});

describe("isCompleteParaguayPhone", () => {
  it("accepts full 10-digit numbers", () => {
    expect(isCompleteParaguayPhone("(0981) 123-456")).toBe(true);
    expect(isCompleteParaguayPhone("0981123456")).toBe(true);
  });

  it("rejects partial numbers", () => {
    expect(isCompleteParaguayPhone("(0981) 123-4")).toBe(false);
    expect(isCompleteParaguayPhone("")).toBe(false);
  });
});
