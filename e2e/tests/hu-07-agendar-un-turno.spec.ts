import { expect, test } from "@playwright/test";
import { loginAsDemo } from "../fixtures/auth";

test.describe("HU-07 · Agendar un turno", () => {
  test("abre el diálogo de nuevo turno", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/calendar");
    await page.getByRole("button", { name: "New appointment" }).first().click();
    await expect(page.getByRole("heading", { name: "New appointment" })).toBeVisible();
  });
});
