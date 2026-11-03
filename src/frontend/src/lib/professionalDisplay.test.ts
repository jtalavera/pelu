import { describe, expect, it } from "vitest";
import { withDisplayNames } from "./professionalDisplay";

describe("withDisplayNames", () => {
  it("shows the nickname in place of the full name", () => {
    const [p] = withDisplayNames([{ id: 1, fullName: "ANA MARIA CACERES", displayName: "Ani" }]);
    expect(p.fullName).toBe("Ani");
    expect(p.id).toBe(1);
  });

  it("keeps the full name when there is no nickname (missing, null or blank)", () => {
    const out = withDisplayNames([
      { fullName: "ANDREA BAEZ" },
      { fullName: "ARACELY AGÜERO", displayName: null },
      { fullName: "JORGELINA AGÜERO", displayName: "  " },
    ]);
    expect(out.map((p) => p.fullName)).toEqual(["ANDREA BAEZ", "ARACELY AGÜERO", "JORGELINA AGÜERO"]);
  });
});
