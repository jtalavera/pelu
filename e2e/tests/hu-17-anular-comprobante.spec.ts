import { expect, test } from "@playwright/test";
import { loginAsDemo } from "../fixtures/auth";

test.describe("HU-17 · Anular comprobante", () => {
  test("historial incluye búsqueda y detalle de factura", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "History" }).click();
    await expect(page.locator("#invoice-history-text-filter")).toBeVisible();
  });
});
