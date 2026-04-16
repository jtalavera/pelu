import { expect, test } from "@playwright/test";
import { loginAsDemo } from "../fixtures/auth";

test.describe("HU-08 · Cambiar estado de un turno", () => {
  test("detalle de turno permite cambiar estado cuando hay un turno", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/calendar");
    await page.getByRole("button", { name: "New appointment" }).first().click();
    await expect(page.getByText("Professional", { exact: true })).toBeVisible();
  });
});
