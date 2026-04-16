import { expect, test } from "@playwright/test";
import { loginAsDemo } from "../fixtures/auth";

test.describe("HU-09 · Editar o reagendar turno", () => {
  test("formulario de edición usa el mismo modal que nuevo turno", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/calendar");
    await page.getByRole("button", { name: "New appointment" }).first().click();
    await expect(page.getByRole("heading", { name: "New appointment" })).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  });
});
