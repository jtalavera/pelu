import { expect, test } from "@playwright/test";
import { loginAsDemo } from "../fixtures/auth";

test.describe("HU-11 · Buscar cliente existente", () => {
  test("listado de clientes con búsqueda", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/clients");
    await expect(page.getByPlaceholder("Search by name, phone, or RUC…").first()).toBeVisible();
  });
});
