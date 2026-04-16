import { expect, test } from "@playwright/test";
import { loginAsDemo } from "../fixtures/auth";

test.describe("HU-02b · Configurar timbrado fiscal", () => {
  test("pantalla de timbrado bajo Ajustes", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/settings/fiscal-stamp");
    await expect(page.getByRole("button", { name: "Deactivate" })).toBeVisible();
  });
});
