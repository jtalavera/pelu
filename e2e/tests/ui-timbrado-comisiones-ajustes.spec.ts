import { expect, test } from "@playwright/test";
import { ensureActiveFiscalStampForInvoices, loginAsDemoApi } from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { stampRowAction } from "../fixtures/ui";
import {
  enableCommissionsGlobally,
  loginAdminUi,
  provisionCommissionWorld,
  restoreCommissionsGlobal,
  type CommissionWorld,
} from "../fixtures/commissions";

/**
 * UI adjustments: (1) breathing room between the user messages and "Registered stamps" on
 * Settings → Stamp, (2) compact action buttons in the stamps table, (3) Commissions tabs share the
 * rounded look of the Billing tabs.
 */
test.describe("Timbrado · mensajes y acciones de fila compactas", () => {
  test("U1: el aviso al activar/desactivar un timbrado no pisa el listado", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await loginAsDemo(page);
    await page.goto("/app/settings/fiscal-stamp");
    const row = page.locator('[data-testid^="fiscal-stamp-row-"]').first();
    await expect(row).toBeVisible({ timeout: 30_000 });

    // Deactivating/activating shows the green confirmation above the list.
    await stampRowAction(page, row, /^(Deactivate|Activate)$/);
    const alert = page.getByRole("alert").or(page.getByRole("status")).first();
    await expect(alert).toBeVisible();

    // The notice sits above the list with air between them (never overlapping the rows).
    const list = page.getByTestId("fiscal-stamp-current-section");
    const alertBox = await alert.boundingBox();
    const listBox = await list.boundingBox();
    expect(listBox!.y - (alertBox!.y + alertBox!.height)).toBeGreaterThanOrEqual(8);

    // Restore the stamp's original state so other specs keep their ambient assumptions.
    await ensureActiveFiscalStampForInvoices(request, token);
  });

  test("U2: cada fila tiene una sola acción visible (el menú ⋯), compacta", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await loginAsDemo(page);
    await page.goto("/app/settings/fiscal-stamp");
    const row = page.locator('[data-testid^="fiscal-stamp-row-"]').first();
    await expect(row).toBeVisible({ timeout: 30_000 });

    // Redesign: Edit / Activate / Deactivate / Delete live in a ⋯ menu instead of 3-4 buttons.
    const buttons = row.getByRole("button");
    await expect(buttons).toHaveCount(1);
    const box = (await buttons.first().boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(48);
    expect(box.height).toBeLessThanOrEqual(48);
    const rowBox = (await row.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(rowBox.x + rowBox.width);
  });
});

test.describe("Comisiones · solapas redondeadas", () => {
  let w: CommissionWorld;
  test.beforeAll(async ({ request }) => {
    await enableCommissionsGlobally(request);
    w = await provisionCommissionWorld(request, "UI-TABS");
  });
  test.afterAll(async ({ request }) => {
    await restoreCommissionsGlobal(request);
  });

  test("U3: los cinco lugares de Comisiones (HU-COM-15) son redondeados y de alto táctil", async ({ page }) => {
    await loginAdminUi(page, w);
    await page.getByRole("link", { name: "Commissions" }).click();
    const links = page.locator('[data-testid^="commissions-nav-"]:not([data-testid*="badge"])');
    await expect(links).toHaveCount(5);
    for (const link of await links.all()) {
      expect(parseFloat(await link.evaluate((e) => getComputedStyle(e).borderTopLeftRadius))).toBeGreaterThanOrEqual(10);
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  });
});
