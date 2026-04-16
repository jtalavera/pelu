import { expect, test } from "@playwright/test";
import { loginAsDemo } from "../fixtures/auth";

test.describe("HU-21 · Fixes varios clientes", () => {
  test("directorio de clientes con filtros y búsqueda", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/clients");
    await expect(page.getByPlaceholder("Search by name, phone, or RUC…").first()).toBeVisible();
  });
});
