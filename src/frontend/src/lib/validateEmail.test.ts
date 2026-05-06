import { describe, expect, it } from "vitest";
import { isValidEmail } from "./validateEmail";

describe("isValidEmail", () => {
  it.each([
    "user@example.com",
    "first.last@sub.example.io",
    "x@y.z",
    "a+b@example.com",
  ])("accepts %s", (s) => {
    expect(isValidEmail(s)).toBe(true);
  });

  it.each([
    "",
    "no-at-sign.com",
    "@no-local.com",
    "user@",
    "user@nodot",
    "user@@double.com",
    "user with space@x.com",
    "user@x .com",
  ])("rejects %s", (s) => {
    expect(isValidEmail(s)).toBe(false);
  });
});
