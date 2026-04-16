import { expect, test } from "@playwright/test";
import { loginAsDemo } from "../fixtures/auth";

test.describe("HU-02 · Configurar datos del negocio", () => {
  test("pantalla de negocio bajo Ajustes", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/settings/business");
    await expect(page.getByLabel("Business name")).toBeVisible();
  });
});
