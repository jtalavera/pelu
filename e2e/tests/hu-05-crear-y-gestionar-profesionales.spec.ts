import { expect, test } from "@playwright/test";
import { loginAsDemo } from "../fixtures/auth";

test.describe("HU-05 · Crear y gestionar profesionales", () => {
  test("página de profesionales con alta disponible", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/professionals");
    await expect(page.getByRole("heading", { name: "Professionals" })).toBeVisible();
    await expect(page.getByRole("button", { name: "+ New professional" })).toBeVisible();
  });
});
