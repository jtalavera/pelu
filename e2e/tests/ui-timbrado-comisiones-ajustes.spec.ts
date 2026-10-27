import { expect, test } from "@playwright/test";
import { ensureActiveFiscalStampForInvoices, loginAsDemoApi } from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
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
test.describe("Timbrado · mensajes y botones compactos", () => {
  test("U1: hay espacio entre el mensaje de éxito y el título de timbrados registrados", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await loginAsDemo(page);
    await page.goto("/app/settings/fiscal-stamp");
    const row = page.locator('[data-testid^="fiscal-stamp-row-"]').first();
    await expect(row).toBeVisible({ timeout: 30_000 });

    // Deactivating/activating shows the green confirmation above the list.
    const toggle = row.getByRole("button", { name: /^(Deactivate|Activate)$/ }).and(row.locator(":enabled"));
    await toggle.click();
    const alert = page.getByRole("alert").or(page.getByRole("status")).first();
    await expect(alert).toBeVisible();

    const title = page.getByText("Registered stamps", { exact: true });
    const alertBox = await alert.boundingBox();
    const titleBox = await title.boundingBox();
    expect(titleBox!.y - (alertBox!.y + alertBox!.height)).toBeGreaterThanOrEqual(20);

    // Restore the stamp's original state so other specs keep their ambient assumptions.
    await ensureActiveFiscalStampForInvoices(request, token);
  });

  test("U2: los botones de acción de cada fila son compactos", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await loginAsDemo(page);
    await page.goto("/app/settings/fiscal-stamp");
    const row = page.locator('[data-testid^="fiscal-stamp-row-"]').first();
    await expect(row).toBeVisible({ timeout: 30_000 });

    for (const name of ["Edit stamp", "Deactivate", "Activate"]) {
      const box = await row.getByRole("button", { name, exact: true }).boundingBox();
      expect(box!.height, name).toBeLessThanOrEqual(30);
      expect(box!.width, name).toBeLessThanOrEqual(90);
    }
    const buttons = await row.getByRole("button").evaluateAll((els) =>
      els.map((e) => Math.round(e.getBoundingClientRect().right)),
    );
    const cell = await row.getByRole("button").first().locator("xpath=ancestor::td").boundingBox();
    expect(cell!.width).toBeLessThanOrEqual(190);
    expect(Math.max(...buttons)).toBeLessThanOrEqual(cell!.x + cell!.width);
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

  test("U3: las solapas de Comisiones tienen el mismo radio y alto que las de Facturación", async ({ page }) => {
    await loginAdminUi(page, w);
    await page.getByRole("link", { name: "Billing" }).click();
    const billingTab = page.getByRole("tab").first();
    await expect(billingTab).toBeVisible();
    const billingRadius = await billingTab.evaluate((e) => getComputedStyle(e).borderTopLeftRadius);
    const billingHeight = Math.round((await billingTab.boundingBox())!.height);

    await page.getByRole("link", { name: "Commissions" }).click();
    const topTabs = page.getByRole("tablist", { name: "Commissions" }).getByRole("tab");
    await expect(topTabs.first()).toBeVisible();
    for (const tab of await topTabs.all()) {
      expect(await tab.evaluate((e) => getComputedStyle(e).borderTopLeftRadius)).toBe(billingRadius);
      expect(Math.round((await tab.boundingBox())!.height)).toBe(billingHeight);
    }

    // Sub-tabs of Rules are rounded too (they used to be an underline strip).
    await page.getByRole("tab", { name: "Rules", exact: true }).click();
    const subTab = page.getByRole("tab", { name: "General rules" });
    await expect(subTab).toBeVisible();
    expect(await subTab.evaluate((e) => getComputedStyle(e).borderTopLeftRadius)).toBe(billingRadius);
    expect(Math.round((await subTab.boundingBox())!.height)).toBe(billingHeight);
    expect(parseFloat(billingRadius)).toBeGreaterThanOrEqual(10);
  });
});
