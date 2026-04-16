import { expect, test } from "@playwright/test";
import { loginAsDemo } from "../fixtures/auth";

test.describe("HU-04 · Crear y gestionar servicios", () => {
  test("página de servicios carga categorías y servicios", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/services");
    await expect(
      page.getByText("Manage categories and services for scheduling and invoicing."),
    ).toBeVisible();
  });
});
