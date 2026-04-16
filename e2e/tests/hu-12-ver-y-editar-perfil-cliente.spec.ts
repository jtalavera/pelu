import { expect, test } from "@playwright/test";
import { loginAsDemo } from "../fixtures/auth";

test.describe("HU-12 · Ver y editar perfil de cliente", () => {
  test("ruta de detalle responde (404 controlado si no hay id)", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/clients/999999");
    await expect(page.getByText("Could not load client profile.")).toBeVisible();
  });
});
