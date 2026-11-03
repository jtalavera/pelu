import { expect, test } from "@playwright/test";
import { API_BASE, apiGetJson } from "../../fixtures/api";
import {
  applyChanges,
  enableCommissionsGlobally,
  entriesOfInvoice,
  generateSettlements,
  issueInvoice,
  loginAdminUi,
  provisionCommissionWorld,
  restoreCommissionsGlobal,
  type CommissionWorld,
  openCommissionsMore,
} from "../../fixtures/commissions";

/** HU-COM-03 · Vista previa de la liquidación de un profesional en el periodo abierto. */
let w: CommissionWorld;

test.beforeAll(async ({ request }) => {
  await enableCommissionsGlobally(request);
});

test.afterAll(async ({ request }) => {
  await restoreCommissionsGlobal(request);
});

test.beforeEach(async ({ request }) => {
  w = await provisionCommissionWorld(request, "HU-COM-03");
  await applyChanges(request, w.adminToken, [
    { scope: "RULE", serviceId: w.service.id, value: "40" },
    { scope: "RULE", serviceId: w.service.id, professionalId: w.bea.id, value: "50" },
    { scope: "DEFAULT_PRODUCT", value: "10" },
  ]);
  const inv = await issueInvoice(request, w.adminToken, [
    { serviceId: w.service.id, name: w.service.name, professionalId: w.ana.id },
    { serviceId: w.product.id, name: w.product.name, professionalId: w.ana.id },
    { serviceId: w.service.id, name: w.service.name, professionalId: w.bea.id },
  ]);
  await entriesOfInvoice(request, w.adminToken, inv.id, 3);
});

async function openPreview(page: import("@playwright/test").Page) {
  await page.getByRole("link", { name: "Commissions" }).click();
  await openCommissionsMore(page, "Preview");
  await expect(page.getByTestId("commission-preview")).toBeVisible();
}

test("muestra cuánto cobraría el profesional en el periodo vigente con las comisiones registradas hasta hoy; no guarda nada", async ({
  page,
  request,
}) => {
  await loginAdminUi(page, w);
  await openPreview(page);
  await page.locator("#preview-professional").selectOption({ label: w.ana.name });
  await page.getByTestId("preview-run").click();
  await expect(page.getByTestId("preview-total")).toContainText("50.000");
  await expect(page.getByTestId("preview-services")).toContainText("40.000");
  await expect(page.getByTestId("preview-products")).toContainText("10.000");
  await expect(page.getByTestId("preview-adjustments")).toContainText("0");
  await expect(page.getByTestId("preview-entries").locator("li")).toHaveCount(2);
  // Everything accrued inside the period: nothing is carried, so no split and no groups.
  await expect(page.getByTestId("preview-split")).toHaveCount(0);
  await expect(page.getByTestId("preview-group-carried")).toHaveCount(0);

  // Bea only sees her own commissions (her exception: 50 %).
  await page.locator("#preview-professional").selectOption({ label: w.bea.name });
  await page.getByTestId("preview-run").click();
  await expect(page.getByTestId("preview-total")).toContainText("50.000");
  await expect(page.getByTestId("preview-entries").locator("li")).toHaveCount(1);

  // Nothing persisted: no settlement was created.
  const settlements = await apiGetJson<{ total: number }>(request, w.adminToken, "/api/commissions/settlements");
  expect(settlements.total).toBe(0);
});

test("pide elegir un profesional; las comisiones ya incluidas en un borrador no se cuentan y se avisa", async ({
  page,
  request,
}) => {
  await loginAdminUi(page, w);
  await openPreview(page);
  await page.getByTestId("preview-run").click();
  await expect(page.locator("#preview-error")).toHaveText("Choose a professional from the list.");

  await generateSettlements(request, w.adminToken, [w.ana.id]);
  await page.locator("#preview-professional").selectOption({ label: w.ana.name });
  await page.getByTestId("preview-run").click();
  await expect(page.getByText("No unsettled commissions for that professional in the period.")).toBeVisible();
  await expect(page.getByText(/already 1 draft settlement for this professional/)).toBeVisible();
});

test("API: la vista previa respeta el rango pedido y valida el profesional", async ({ request }) => {
  const headers = { Authorization: `Bearer ${w.adminToken}` };
  const ok = await apiGetJson<{ total: number; lines: number }>(
    request,
    w.adminToken,
    `/api/commissions/settlement-preview?professionalId=${w.ana.id}`,
  );
  expect(Number(ok.total)).toBe(50000);
  expect(ok.lines).toBe(2);
  const past = await apiGetJson<{ total: number; lines: number }>(
    request,
    w.adminToken,
    `/api/commissions/settlement-preview?professionalId=${w.ana.id}&from=2020-01-01&to=2020-01-31`,
  );
  expect(past.lines).toBe(0);
  const missing = await request.get(`${API_BASE}/api/commissions/settlement-preview?professionalId=999999`, { headers });
  expect(missing.status()).toBe(404);
  expect(await missing.text()).toContain("PROFESSIONAL_NOT_FOUND");
});

/** Picks a day in the date popover of a `LocalizedDateInput` (day buttons are labelled with the ISO date). */
async function pickDay(page: import("@playwright/test").Page, inputId: string, iso: string) {
  await page.locator(inputId).click();
  const next = page.getByRole("button", { name: "Next month" });
  const day = page.getByRole("button", { name: iso, exact: true });
  for (let i = 0; i < 14; i++) {
    if (await day.first().isVisible().catch(() => false)) break;
    await next.click();
  }
  await day.first().click({ timeout: 15_000 });
}

function ymd(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 24 * 3600_000);
  return d.toLocaleDateString("sv-SE");
}

test("lo pendiente de antes del periodo se ve como «Arrastrado»: total partido, grupo propio y etiqueta por línea; el total no cambia", async ({
  page,
  request,
}) => {
  await loginAdminUi(page, w);
  await openPreview(page);
  await page.locator("#preview-professional").selectOption({ label: w.ana.name });
  // The period starts tomorrow: what Ana accrued today comes from before it.
  await pickDay(page, "#preview-from", ymd(1));
  await pickDay(page, "#preview-to", ymd(40));
  await page.getByTestId("preview-run").click();

  // Same total as the settlement would take (carried commissions are included).
  await expect(page.getByTestId("preview-total")).toContainText("50.000");
  await expect(page.getByTestId("preview-split")).toBeVisible();
  await expect(page.getByTestId("preview-carried-amount")).toContainText("50.000");
  await expect(page.getByTestId("preview-period-amount")).toContainText("0");
  await expect(page.getByTestId("preview-group-carried")).toContainText("2 lines");
  await expect(page.getByTestId("preview-before-period")).toHaveCount(2);
  // Nothing of the period itself: no period group.
  await expect(page.getByTestId("preview-group-period")).toHaveCount(0);

  // Still nothing persisted.
  const settlements = await apiGetJson<{ total: number }>(request, w.adminToken, "/api/commissions/settlements");
  expect(settlements.total).toBe(0);
  // The API reports the carried part and its entries.
  const api = await apiGetJson<{ total: number; carriedAmount: number; carriedEntryIds: number[] }>(
    request,
    w.adminToken,
    `/api/commissions/settlement-preview?professionalId=${w.ana.id}&from=${ymd(1)}&to=${ymd(40)}`,
  );
  expect(api.total).toBe(50_000);
  expect(api.carriedAmount).toBe(50_000);
  expect(api.carriedEntryIds).toHaveLength(2);
});
