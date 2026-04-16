import { expect, test } from "@playwright/test";
import { loginAsDemo } from "../fixtures/auth";

test.describe("HU-03 · Dashboard principal", () => {
  test("muestra el dashboard tras iniciar sesión", async ({ page }) => {
    await loginAsDemo(page);
    await expect(page.getByText("Appointments today", { exact: true }).first()).toBeVisible();
  });
});
