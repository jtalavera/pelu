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
