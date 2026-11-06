import { describe, expect, it } from "vitest";
import { filterByListQuery, findQueryMatch, matchesListQuery, normalizeForSearch } from "./matchesListQuery";

describe("matchesListQuery", () => {
  it("matches case-insensitive substring", () => {
    expect(matchesListQuery("Ana García", "gar")).toBe(true);
    expect(matchesListQuery("Ana García", "ANA")).toBe(true);
    expect(matchesListQuery("Ana García", "xyz")).toBe(false);
  });

  it("treats empty query as match all", () => {
    expect(matchesListQuery("x", "")).toBe(true);
    expect(matchesListQuery("x", "   ")).toBe(true);
  });
});

describe("accent-insensitive search", () => {
  it("matches with or without accents, in either direction", () => {
    expect(matchesListQuery("TANIA NUÑEZ Z", "nunez")).toBe(true);
    expect(matchesListQuery("Nunez", "nuñ")).toBe(true);
    expect(matchesListQuery("Coloración", "coloracion")).toBe(true);
  });

  it("finds the range to highlight in the original text", () => {
    expect(findQueryMatch("TANIA NUÑEZ Z", "nunez")).toEqual([6, 11]);
    expect(findQueryMatch("Spa de pies", "DE")).toEqual([4, 6]);
    expect(findQueryMatch("Spa de pies", "xyz")).toBeNull();
    expect(findQueryMatch("Spa de pies", "  ")).toBeNull();
  });
});

describe("normalizeForSearch", () => {
  it("trims and lowercases", () => {
    expect(normalizeForSearch("  Hello  ")).toBe("hello");
  });
});

describe("filterByListQuery", () => {
  it("filters by any part", () => {
    const rows = [
      { id: 1, name: "Alpha", note: "x" },
      { id: 2, name: "Beta", note: "y" },
    ];
    const out = filterByListQuery(rows, "alp", (r) => [r.name, r.note]);
    expect(out.map((r) => r.id)).toEqual([1]);
  });

  it("returns all when query is blank", () => {
    const rows = [{ id: 1, name: "A" }];
    expect(filterByListQuery(rows, "", (r) => [r.name])).toEqual(rows);
  });
});
