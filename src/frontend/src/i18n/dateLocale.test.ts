import { describe, expect, it } from "vitest";
import { getDateLocale, DATE_LOCALE_EN, DATE_LOCALE_ES } from "./dateLocale";

describe("getDateLocale", () => {
  it("returns es-PY when resolved language is Spanish", () => {
    expect(
      getDateLocale({ language: "en", resolvedLanguage: "es" }),
    ).toBe(DATE_LOCALE_ES);
    expect(getDateLocale({ language: "es", resolvedLanguage: "es-PY" })).toBe(
      DATE_LOCALE_ES,
    );
    expect(getDateLocale({ language: "es-AR", resolvedLanguage: undefined })).toBe(
      DATE_LOCALE_ES,
    );
  });

  it("returns en-US for non-Spanish languages", () => {
    expect(getDateLocale({ language: "en", resolvedLanguage: "en" })).toBe(
      DATE_LOCALE_EN,
    );
    expect(getDateLocale({ language: "en-US", resolvedLanguage: undefined })).toBe(
      DATE_LOCALE_EN,
    );
  });

  it("falls back to en-US when language is missing", () => {
    expect(getDateLocale({ language: "", resolvedLanguage: undefined })).toBe(
      DATE_LOCALE_EN,
    );
  });
});
