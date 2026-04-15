import { describe, expect, it } from "vitest";
import { categoryAccentStyle } from "./categoryAccent";

describe("categoryAccentStyle", () => {
  it("maps known keys to CSS variables", () => {
    expect(categoryAccentStyle("rose").bg).toContain("--color-rose-lt");
    expect(categoryAccentStyle("mauve").color).toContain("--color-mauve");
  });

  it("defaults unknown keys to neutral stone", () => {
    const s = categoryAccentStyle("unknown");
    expect(s.bg).toContain("--color-stone");
  });
});
