import { expect, test } from "@playwright/test";
import { loginAsDemo } from "../fixtures/auth";

test.describe("HU-06 · Calendario de turnos", () => {
  test("vista semanal de citas", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/calendar");
    await expect(page.getByRole("heading", { name: "Appointments" })).toBeVisible();
  });
});
