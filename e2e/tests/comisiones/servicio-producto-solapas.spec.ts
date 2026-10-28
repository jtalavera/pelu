import { expect, test } from "@playwright/test";
import {
  enableCommissionsGlobally,
  loginAdminUi,
  provisionCommissionWorld,
  restoreCommissionsGlobal,
  type CommissionWorld,
} from "../../fixtures/commissions";

/**
 * Servicios y Productos · el pop-up de edición separa por solapas los «Datos» del ítem de su
 * «Comisión» (mismo patrón que el detalle de comprobante: Factura / SIFEN).
 */
let w: CommissionWorld;

test.beforeAll(async ({ request }) => {
  await enableCommissionsGlobally(request);
});

test.afterAll(async ({ request }) => {
  await restoreCommissionsGlobal(request);
});

test.beforeEach(async ({ request }) => {
  w = await provisionCommissionWorld(request, "SOLAPAS");
});

for (const kind of ["service", "product"] as const) {
  test(`${kind} · Datos y Comisión en solapas; Datos por defecto con Guardar/Cancelar; Comisión sin esos botones`, async ({
    page,
  }) => {
    await loginAdminUi(page, w);
    const item = kind === "service" ? w.service : w.product;
    await page.getByRole("link", { name: kind === "service" ? "Services" : "Products" }).click();
    await page.getByTestId(`svc-row-${item.id}`).click();
    const dialog = page.getByRole("dialog", { name: kind === "service" ? "Edit service" : "Edit product" });
    await expect(dialog).toBeVisible();

    // Two tabs, Details first and selected by default.
    await expect(dialog.getByRole("tab")).toHaveText(["Details", "Commission"]);
    await expect(dialog.getByTestId("svc-tab-details")).toHaveAttribute("aria-selected", "true");

    // Details tab: the item data and the Save / Cancel buttons; the commission rules are hidden.
    const details = dialog.getByTestId("svc-panel-details");
    await expect(details.getByLabel("Name")).toBeVisible();
    await expect(details.getByLabel("Category")).toBeVisible();
    await expect(details.getByLabel("Price")).toBeVisible();
    await expect(details.getByRole("button", { name: "Save" })).toBeVisible();
    await expect(details.getByRole("button", { name: "Cancel" })).toBeVisible();
    await expect(dialog.getByTestId("item-commission-section")).toBeHidden();

    // Commission tab: the rules editor, without the item's Save / Cancel buttons.
    await dialog.getByTestId("svc-tab-commission").click();
    await expect(dialog.getByTestId("svc-tab-commission")).toHaveAttribute("aria-selected", "true");
    await expect(dialog.getByTestId("item-commission-section")).toBeVisible();
    await expect(dialog.getByTestId("svc-panel-details")).toBeHidden();
    await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeHidden();

    // Back to Details: the data is still there.
    await dialog.getByTestId("svc-tab-details").click();
    await expect(dialog.getByLabel("Name")).toHaveValue(item.name);
  });
}

test("al reabrir el pop-up siempre arranca en Datos", async ({ page }) => {
  await loginAdminUi(page, w);
  await page.getByRole("link", { name: "Services" }).click();
  await page.getByTestId(`svc-row-${w.service.id}`).click();
  const dialog = page.getByRole("dialog", { name: "Edit service" });
  await dialog.getByTestId("svc-tab-commission").click();
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByTestId(`svc-row-${w.service.id}`).click();
  await expect(page.getByTestId("svc-tab-details")).toHaveAttribute("aria-selected", "true");
});

test("un servicio nuevo no muestra solapas (la comisión se define al editar)", async ({ page }) => {
  await loginAdminUi(page, w);
  await page.getByRole("link", { name: "Services" }).click();
  await page.getByRole("button", { name: "+ New service" }).click();
  const dialog = page.getByRole("dialog", { name: "New service" });
  await expect(dialog.getByLabel("Name")).toBeVisible();
  await expect(dialog.getByRole("tab")).toHaveCount(0);
});
