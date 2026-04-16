import { expect, test } from "@playwright/test";
import { loginAsDemo } from "../fixtures/auth";

test.describe("HU-10 · Crear cliente", () => {
  test("abre el formulario de nuevo cliente", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/clients");
    await expect(page.getByRole("heading", { name: "Clients" })).toBeVisible();
    await page.getByRole("button", { name: "+ New client" }).first().click();
    await expect(page.getByRole("heading", { name: "New client" })).toBeVisible();
  });
});
