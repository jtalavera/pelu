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
  openCommissions,
  openProfessional,
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

/** HU-COM-15: the «Vista previa» is the «Resumen» tab of each professional (Equipo). */
async function openSummary(page: import("@playwright/test").Page, name: string) {
  await openCommissions(page);
  await openProfessional(page, name, "summary");
  await expect(page.getByTestId("pro-summary")).toBeVisible();
}

test("muestra cuánto cobraría el profesional en el periodo vigente con las comisiones registradas hasta hoy; no guarda nada", async ({
  page,
  request,
}) => {
  await loginAdminUi(page, w);
  await openSummary(page, w.ana.name);
  await expect(page.getByTestId("pro-summary-total")).toContainText("50.000");
  await expect(page.getByTestId("pro-summary-services")).toContainText("40.000");
  await expect(page.getByTestId("pro-summary-products")).toContainText("10.000");
  await expect(page.getByTestId("pro-summary-lines")).toContainText("2 invoiced lines");
  // HU-COM-33: the stage is the current step of the path (To generate → Draft → Approved → Paid).
  await expect(page.locator('[data-testid="pro-step"][data-state="current"]')).toContainText("To generate");

  // Bea only sees her own commissions (her exception: 50 %).
  await page.getByTestId("pro-back").click();
  await openProfessional(page, w.bea.name, "summary");
  await expect(page.getByTestId("pro-summary-total")).toContainText("50.000");
  await expect(page.getByTestId("pro-summary-lines")).toContainText("1 invoiced line");

  // Nothing persisted: no settlement was created.
  const settlements = await apiGetJson<{ total: number }>(request, w.adminToken, "/api/commissions/settlements");
  expect(settlements.total).toBe(0);
});

test("lo ya incluido en un borrador figura como Borrador y se llega a su liquidación desde el resumen", async ({
  page,
  request,
}) => {
  const [draft] = await generateSettlements(request, w.adminToken, [w.ana.id]);
  await loginAdminUi(page, w);
  await openSummary(page, w.ana.name);
  await expect(page.locator('[data-testid="pro-step"][data-state="current"]')).toContainText("Draft");
  await expect(page.getByTestId("pro-summary-total")).toContainText("50.000");
  // HU-COM-33: the breakdown comes from the draft itself, so it adds up to the total (it used to read 0 here).
  await expect(page.getByTestId("pro-summary-services")).toContainText("40.000");
  await expect(page.getByTestId("pro-summary-products")).toContainText("10.000");
  await expect(page.getByTestId("pro-summary-lines")).toContainText("2 invoiced lines");
  await page.getByTestId("pro-summary-open-settlement").click();
  await expect(page).toHaveURL(new RegExp(`/app/commissions/settlements/${draft.id}$`));
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
  // A past range (within the 1-year search limit) before anything was accrued: nothing to settle.
  const past = await apiGetJson<{ total: number; lines: number }>(
    request,
    w.adminToken,
    `/api/commissions/settlement-preview?professionalId=${w.ana.id}&from=${ymd(-300)}&to=${ymd(-270)}`,
  );
  expect(past.lines).toBe(0);
  // Older than 1 year: rejected.
  const tooOld = await request.get(
    `${API_BASE}/api/commissions/settlement-preview?professionalId=${w.ana.id}&from=2020-01-01&to=2020-01-31`,
    { headers },
  );
  expect(tooOld.status()).toBe(400);
  expect(await tooOld.text()).toContain("DATE_RANGE_TOO_OLD");
  const missing = await request.get(`${API_BASE}/api/commissions/settlement-preview?professionalId=999999`, { headers });
  expect(missing.status()).toBe(404);
  expect(await missing.text()).toContain("PROFESSIONAL_NOT_FOUND");
});


function ymd(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 24 * 3600_000);
  return d.toLocaleDateString("sv-SE");
}

test("API: lo pendiente de antes del periodo se informa como «Arrastrado» y el total no cambia", async ({ request }) => {
  // The period starts tomorrow: what Ana accrued today comes from before it.
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
