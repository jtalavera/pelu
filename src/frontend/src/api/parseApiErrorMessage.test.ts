import { describe, expect, it } from "vitest";
import { looksLikeRucValidationError, parseApiErrorMessage } from "./parseApiErrorMessage";

describe("parseApiErrorMessage", () => {
  it("returns plain Error message when not JSON", () => {
    expect(parseApiErrorMessage(new Error("plain"))).toBe("plain");
  });

  it("parses JSON message field", () => {
    expect(parseApiErrorMessage(new Error('{"message":"Invalid RUC"}'))).toBe("Invalid RUC");
  });

  it("parses JSON title field when message missing", () => {
    expect(parseApiErrorMessage(new Error('{"title":"Bad Request"}'))).toBe("Bad Request");
  });
});

describe("looksLikeRucValidationError", () => {
  it("detects RUC-related messages", () => {
    expect(looksLikeRucValidationError("Invalid RUC format")).toBe(true);
    expect(looksLikeRucValidationError("something else")).toBe(false);
  });
});
