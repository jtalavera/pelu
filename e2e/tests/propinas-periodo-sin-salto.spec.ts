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

test.describe("Propinas · Movimientos en celular", () => {
  test("son una lista de filas de dos líneas y el monto se ve sin deslizar", async ({ page, request }) => {
    test.setTimeout(90_000);
    const token = await loginAsDemoApi(request);
    const pro = await apiPostJson<{ id: number }>(request, token, "/api/professionals", {
      fullName: `Zzcelu ${Date.now()}`,
      phone: null,
      email: null,
      photoDataUrl: null,
    });
    await apiPostJson(request, token, "/api/propinas/manual", {
      professionalId: pro.id,
      amount: 12000,
      tippedAt: new Date(Date.now() - 3_600_000).toISOString(),
      note: "Efectivo",
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await loginAsDemo(page);
    await page.goto("/app/propinas");
    const cards = page.getByTestId("propinas-movements-cards");
    await expect(cards).toBeVisible({ timeout: 20_000 });
    // No four-column table that has to be scrolled sideways.
    await expect(page.getByTestId("propinas-table")).toHaveCount(0);

    const row = cards.getByTestId("propinas-movement").first();
    await row.scrollIntoViewIfNeeded();
    await expect(row.getByTestId("propinas-movement-concept")).toBeVisible();
    // The amount is fully inside the screen (it used to be cut off on the right).
    const amount = await row.getByTestId("propinas-movement-amount").boundingBox();
    expect(amount).not.toBeNull();
    expect(amount!.x).toBeGreaterThanOrEqual(0);
    expect(amount!.x + amount!.width).toBeLessThanOrEqual(390);
    // Nothing makes the page wider than the phone.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // The manual tip's menu is there for the admin and opens inside the screen.
    // (a voided tip from another spec has no menu: take a live one)
    const manualRow = cards.locator('[data-manual="true"]:not([data-voided="true"])').first();
    await manualRow.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await manualRow.getByRole("button").click();
    await expect(page.getByRole("menuitem", { name: "Edit" })).toBeVisible();
  });
});
