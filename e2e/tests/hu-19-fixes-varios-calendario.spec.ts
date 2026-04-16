import { expect, test } from "@playwright/test";
import { loginAsDemo } from "../fixtures/auth";

test.describe("HU-19 · Fixes varios del calendario", () => {
  test("filtro de profesionales con placeholder de búsqueda", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/calendar");
    await expect(page.getByPlaceholder("Type to filter…").first()).toBeVisible();
  });
});
