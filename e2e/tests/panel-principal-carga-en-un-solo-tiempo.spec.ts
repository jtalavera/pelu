import { expect, test } from "@playwright/test";
import { loginAsDemo } from "../fixtures/auth";

/**
 * Panel principal (Inicio): resumen, agenda, fichas y cumpleaños se piden a la vez y la pantalla se
 * muestra una sola vez, cuando todo respondió — antes aparecía primero «0 turnos hoy» y la agenda y
 * las fichas entraban después.
 */
test.describe("Panel principal · carga en un solo tiempo", () => {
  test("no muestra el resumen ni las fichas hasta que la agenda y las fichas respondieron", async ({ page }) => {
    // Log in first (the helper waits for the page itself), then hold the agenda and the fichas
    // requests and reload: nothing of the page may show up on its own.
    await loginAsDemo(page);
    await page.goto("/app/hoy");
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/appointments?*", async (route) => {
      await gate;
      await route.continue();
    });
    await page.route("**/api/service-records?*", async (route) => {
      await gate;
      await route.continue();
    });

    await page.goto("/app/hoy");
    await expect(page.getByTestId("dashboard-loading")).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(700);
    await expect(page.getByTestId("dashboard-summary")).toBeHidden();
    await expect(page.getByTestId("dashboard-loading")).toBeVisible();

    release();
    // Everything appears together: summary and the agenda and fichas sections.
    await expect(page.getByTestId("dashboard-summary")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("dashboard-new-service-record")).toBeVisible();
    await expect(page.getByTestId("dashboard-loading")).toHaveCount(0);
  });
});
