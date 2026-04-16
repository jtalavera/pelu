import { expect, test } from "@playwright/test";
import { loginAsDemo } from "../fixtures/auth";
import { ensureCashSessionOpen } from "../fixtures/billing";

test.describe("HU-18 · Cerrar caja del día", () => {
  test("botón para iniciar cierre de caja", async ({ page }) => {
    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "Cash Register" }).click();
    await expect(page.getByRole("button", { name: "Close cash register" })).toBeVisible();
  });
});
