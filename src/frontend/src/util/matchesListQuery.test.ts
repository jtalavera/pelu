import { describe, expect, it } from "vitest";
import { filterByListQuery, matchesListQuery, normalizeForSearch } from "./matchesListQuery";

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
