import { describe, expect, it } from "vitest";
import { isStrongPassword } from "./passwordPolicy";

describe("isStrongPassword", () => {
  it("accepts a password meeting every rule", () => {
    expect(isStrongPassword("Abc1@xyz")).toBe(true);
    expect(isStrongPassword("ValidPass1!")).toBe(true);
  });

  it.each([
    ["Abc1@xy", "7 characters"],
    ["abc1@xyz", "no uppercase"],
    ["ABC1@XYZ", "no lowercase"],
    ["Abcd@xyz", "no digit"],
    ["Abc12xyz", "no special character"],
    ["", "empty"],
  ])("rejects %s (%s)", (pw) => {
    expect(isStrongPassword(pw)).toBe(false);
  });
});
