import { expect, test } from "@playwright/test";
import { loginAsDemo } from "../fixtures/auth";

test.describe("HU-16 · Historial de comprobantes", () => {
  test("pestaña de historial de facturas", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "History" }).click();
    await expect(page.getByRole("heading", { name: "Invoice history" })).toBeVisible();
  });
});
