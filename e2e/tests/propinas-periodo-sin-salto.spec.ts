import { expect, test } from "@playwright/test";
import { apiPostJson, loginAsDemoApi } from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

/**
 * Propinas · Movimientos: al elegir 7 / 30 / 90 días la lista no se reemplaza por un spinner (la
 * tarjeta se achicaba, la pantalla se movía y volvía a crecer): las filas anteriores quedan
 * atenuadas hasta que llegan las nuevas y la tarjeta mantiene su alto.
 */
test.describe("Propinas · cambio de período sin salto", () => {
  test("la lista queda en pantalla (atenuada) mientras cargan los movimientos del nuevo período", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const token = await loginAsDemoApi(request);
    const pro = await apiPostJson<{ id: number }>(request, token, "/api/professionals", {
      fullName: `Zzperiodo ${Date.now()}`,
      phone: null,
      email: null,
      photoDataUrl: null,
    });
    for (let i = 0; i < 4; i++) {
      await apiPostJson(request, token, "/api/propinas/manual", {
        professionalId: pro.id,
        amount: 1000 * (i + 1),
        tippedAt: new Date(Date.now() - (i + 1) * 3_600_000).toISOString(),
        note: null,
      });
    }

    await loginAsDemo(page);
    await page.goto("/app/propinas");
    const card = page.getByTestId("propinas-movements");
    const list = page.getByTestId("propinas-movements-list");
    await expect(page.getByTestId("propinas-table")).toBeVisible({ timeout: 20_000 });
    await expect(list).toHaveAttribute("aria-busy", "false");
    const before = (await card.boundingBox())!.height;

    // Hold the report request of the newly picked period.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/propinas/report?*", async (route) => {
      await gate;
      await route.continue();
    });

    await page.getByTestId("propinas-period-7").click();
    await expect(page.getByTestId("propinas-period-7")).toHaveAttribute("aria-pressed", "true");
    await expect(list).toHaveAttribute("aria-busy", "true");
    // The rows are still there and the card did not shrink while it waits.
    await expect(page.getByTestId("propinas-table")).toBeVisible();
    expect((await card.boundingBox())!.height).toBeGreaterThanOrEqual(before - 1);

    release();
    await expect(list).toHaveAttribute("aria-busy", "false");
    await expect(page.getByTestId("propinas-table")).toBeVisible();

    // Same for the other periods.
    await page.getByTestId("propinas-period-90").click();
    await expect(page.getByTestId("propinas-period-90")).toHaveAttribute("aria-pressed", "true");
    await expect(list).toHaveAttribute("aria-busy", "false");
    await expect(page.getByTestId("propinas-table")).toBeVisible();
  });
});
