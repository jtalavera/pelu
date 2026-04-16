import { expect, test } from "@playwright/test";
import { loginAsDemo } from "../fixtures/auth";

test.describe("HU-20 · Fixes varios profesionales", () => {
  test("listado con búsqueda inline de profesionales", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/professionals");
    await expect(page.getByPlaceholder("Search by name or email…")).toBeVisible();
  });
});
