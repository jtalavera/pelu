import { describe, expect, it } from "vitest";
import { looksLikeRucValidationError, parseApiErrorMessage } from "./parseApiErrorMessage";

describe("parseApiErrorMessage", () => {
  it("returns plain Error message when not JSON", () => {
    expect(parseApiErrorMessage(new Error("plain"))).toBe("plain");
  });

  it("parses JSON error field (backend error code, highest priority)", () => {
    expect(parseApiErrorMessage(new Error('{"error":"INVALID_RUC_FORMAT"}'))).toBe("INVALID_RUC_FORMAT");
  });

  it("parses JSON message field when error is absent", () => {
    expect(parseApiErrorMessage(new Error('{"message":"Invalid RUC"}'))).toBe("Invalid RUC");
  });

  it("parses JSON title field when error and message are absent", () => {
    expect(parseApiErrorMessage(new Error('{"title":"Bad Request"}'))).toBe("Bad Request");
  });

  it("returns empty string for empty message", () => {
    expect(parseApiErrorMessage(new Error(""))).toBe("");
  });

  it("coerces non-Error to string", () => {
    expect(parseApiErrorMessage("raw string")).toBe("raw string");
  });
});

describe("looksLikeRucValidationError", () => {
  it("detects INVALID_RUC_FORMAT error code", () => {
    expect(looksLikeRucValidationError("INVALID_RUC_FORMAT")).toBe(true);
  });

  it("detects RUC-related messages by keyword", () => {
    expect(looksLikeRucValidationError("Invalid RUC format")).toBe(true);
  });

  it("returns false for unrelated messages", () => {
    expect(looksLikeRucValidationError("something else")).toBe(false);
  });
});
