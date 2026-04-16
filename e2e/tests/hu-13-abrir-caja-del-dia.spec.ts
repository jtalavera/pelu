import { expect, test } from "@playwright/test";
import { loginAsDemo } from "../fixtures/auth";
import { ensureCashSessionOpen } from "../fixtures/billing";

test.describe("HU-13 · Abrir caja del día", () => {
  test("abrir caja con monto inicial y ver confirmación", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/billing");
    await expect(page.getByText("Manage the daily cash register and issue invoices.")).toBeVisible();
    await page.getByRole("tab", { name: "Cash Register" }).click();
    const openBtn = page.getByRole("button", { name: "Open cash register" });
    if (await openBtn.isVisible()) {
      await page.getByLabel("Initial cash amount").fill("50000");
      await openBtn.click();
      await expect(page.getByText(/^Cash register is open$/)).toBeVisible({ timeout: 30_000 });
    } else {
      await expect(page.getByText(/^Cash register is open$/)).toBeVisible();
    }
  });

  test("fixture reutilizable deja sesión abierta para facturación", async ({ page }) => {
    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await expect(page.getByText("Cash register is open")).toBeVisible();
  });
});
