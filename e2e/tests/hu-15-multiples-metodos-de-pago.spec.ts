import { expect, test } from "@playwright/test";
import { loginAsDemo } from "../fixtures/auth";
import { ensureCashSessionOpen } from "../fixtures/billing";

test.describe("HU-15 · Múltiples métodos de pago", () => {
  test("formulario de factura incluye sección de métodos de pago", async ({ page }) => {
    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "New Invoice" }).click();
    await expect(page.getByText("Payment methods", { exact: true })).toBeVisible();
  });
});
