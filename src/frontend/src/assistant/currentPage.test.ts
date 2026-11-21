import { describe, expect, it } from "vitest";
import { deriveAssistantPage } from "./currentPage";

describe("deriveAssistantPage", () => {
  it.each([
    ["/app", "resumen"],
    ["/app/", "resumen"],
    ["/app/hoy", "hoy"],
    ["/app/calendar", "calendar"],
    ["/app/clients/12/technical-sheet", "clients"],
    ["/app/settings/business", "settings"],
    ["/app/Dashboards", "dashboards"],
  ])("%s → %s", (path, expected) => {
    expect(deriveAssistantPage(path)).toBe(expected);
  });

  it("is empty outside the salon app, and for anything that is not a plain name", () => {
    expect(deriveAssistantPage("/login")).toBe("");
    expect(deriveAssistantPage("/platform/tenants")).toBe("");
    expect(deriveAssistantPage("/app/%20ignore%20all")).toBe("");
  });
});
