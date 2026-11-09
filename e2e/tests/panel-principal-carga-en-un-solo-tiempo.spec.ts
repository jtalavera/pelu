import { expect, test } from "@playwright/test";
import { loginAsDemo } from "../fixtures/auth";

/**
 * Panel principal (Inicio): resumen, agenda, fichas y cumpleaños se piden a la vez y la pantalla se
 * muestra una sola vez, cuando todo respondió — antes aparecía primero «0 turnos hoy» y la agenda y
 * las fichas entraban después.
 */
test.describe("Panel principal · carga en un solo tiempo", () => {
  test("no muestra el resumen ni las fichas hasta que la agenda y las fichas respondieron", async ({ page }) => {
    // Hold the agenda and the fichas requests: nothing of the page may show up on its own.
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

    await loginAsDemo(page);
    await page.goto("/app");
    await expect(page.getByTestId("dashboard-loading")).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(700);
    await expect(page.getByTestId("dashboard-summary")).toBeHidden();
    await expect(page.getByTestId("dashboard-more")).toBeHidden();
    await expect(page.getByTestId("dashboard-loading")).toBeVisible();

    release();
    // Everything appears together: summary, agenda section and fichas section.
    await expect(page.getByTestId("dashboard-summary")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("dashboard-more")).toBeVisible();
    await expect(page.getByTestId("dashboard-new-service-record")).toBeVisible();
    await expect(page.getByTestId("dashboard-loading")).toHaveCount(0);
  });
});
