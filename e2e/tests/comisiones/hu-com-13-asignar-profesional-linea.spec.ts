import { expect, test } from "@playwright/test";
import { API_BASE, apiGetJson, apiPostJson } from "../../fixtures/api";
import {
  applyChanges,
  enableCommissionsGlobally,
  entries,
  issueInvoice,
  loginAdminUi,
  provisionCommissionWorld,
  restoreCommissionsGlobal,
  voidInvoice,
  type CommissionWorld,
} from "../../fixtures/commissions";

/** HU-COM-13 · Asignar un profesional a una línea facturada sin profesional. */
let w: CommissionWorld;
let invoiceId: number;
let lineId: number;

type Orphan = { invoiceLineId: number; invoiceId: number; description: string };

test.beforeAll(async ({ request }) => {
  await enableCommissionsGlobally(request);
});

test.afterAll(async ({ request }) => {
  await restoreCommissionsGlobal(request);
});

test.beforeEach(async ({ request }) => {
  w = await provisionCommissionWorld(request, "HU-COM-13");
  await applyChanges(request, w.adminToken, [
    { scope: "RULE", serviceId: w.service.id, value: "40" },
    { scope: "RULE", serviceId: w.service.id, professionalId: w.bea.id, value: "50" },
  ]);
  const inv = await issueInvoice(request, w.adminToken, [{ serviceId: w.service.id, name: w.service.name }]);
  invoiceId = inv.id;
  const orphans = await apiGetJson<Orphan[]>(request, w.adminToken, "/api/commissions/lines-without-beneficiary");
  lineId = orphans.find((o) => o.invoiceId === invoiceId)!.invoiceLineId;
});

const ofInvoice = async (request: import("@playwright/test").APIRequestContext) =>
  (await entries(request, w.adminToken)).filter((e) => e.invoiceId === invoiceId);

test("desde «Líneas sin profesional»: elige un profesional, genera su comisión con sus reglas y la línea deja de figurar", async ({
  page,
  request,
}) => {
  expect(await ofInvoice(request)).toHaveLength(0); // billed without professional → no commission

  await loginAdminUi(page, w);
  await page.getByRole("link", { name: "Commissions" }).click();
  await page.getByRole("tab", { name: "Reports" }).click();
  const row = page.getByTestId(`orphan-line-${lineId}`);
  await expect(row).toContainText(w.service.name);
  await row.getByRole("button", { name: "Assign professional" }).click();

  const dialog = page.getByTestId("assign-line-dialog");
  await expect(dialog).toContainText("The invoice is not modified.");
  await page.getByTestId("assign-line-confirm").click();
  await expect(page.locator("#assign-line-error")).toHaveText("Choose a professional from the list.");
  await expect(page.locator("#assign-line-professional")).toHaveAttribute("aria-invalid", "true");
  await page.locator("#assign-line-professional").selectOption({ label: w.bea.name });
  await page.locator("#assign-line-note").fill("No se cargó al facturar");
  await page.getByTestId("assign-line-confirm").click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: `Line assigned to ${w.bea.name}` })).toBeVisible();
  await expect(page.getByTestId(`orphan-line-${lineId}`)).toHaveCount(0);

  // Bea's commission, computed with her own exception (50 %), unsettled → in her next settlement.
  const [entry] = await ofInvoice(request);
  expect(entry.professionalId).toBe(w.bea.id);
  expect(entry.sourceType).toBe("INVOICE_LINE");
  expect(entry.ruleOrigin).toBe("BENEFICIARY_ITEM");
  expect(Number(entry.commissionAmount)).toBe(50000);
  expect(entry.settlementId).toBeNull();
  const preview = await apiGetJson<{ total: number }>(
    request,
    w.adminToken,
    `/api/commissions/settlement-preview?professionalId=${w.bea.id}`,
  );
  expect(Number(preview.total)).toBe(50000);

  // It now shows in Movements like any other commission, and can be reassigned.
  await page.getByRole("tab", { name: "Movements" }).click();
  const movement = page.getByTestId("movement-row").filter({ hasText: w.bea.name });
  await expect(movement).toContainText("50.000");
  await expect(movement).toContainText("No se cargó al facturar");
  await expect(movement.getByRole("button", { name: "Change professional" })).toBeVisible();
});

test("anular la factura después de asignar revierte la comisión del profesional asignado", async ({ request }) => {
  await apiPostJson(request, w.adminToken, `/api/commissions/invoice-lines/${lineId}/assign`, {
    professionalId: w.ana.id,
    note: null,
  });
  await voidInvoice(request, w.adminToken, invoiceId);
  await expect
    .poll(async () => (await ofInvoice(request)).length, { timeout: 15_000 })
    .toBe(2);
  const es = await ofInvoice(request);
  expect(es.every((e) => e.professionalId === w.ana.id)).toBe(true);
  expect(es.reduce((s, e) => s + Number(e.commissionAmount), 0)).toBe(0);
});

test("API: errores al asignar (ya asignada, inexistente, profesional faltante, factura anulada)", async ({
  request,
}) => {
  const headers = { Authorization: `Bearer ${w.adminToken}`, "Content-Type": "application/json" };
  const post = (id: number, data: object) =>
    request.post(`${API_BASE}/api/commissions/invoice-lines/${id}/assign`, { headers, data });

  let res = await post(lineId, { professionalId: null });
  expect(res.status()).toBe(404);
  expect(await res.text()).toContain("PROFESSIONAL_NOT_FOUND");
  res = await post(999999999, { professionalId: w.ana.id });
  expect(res.status()).toBe(404);
  expect(await res.text()).toContain("INVOICE_LINE_NOT_FOUND");

  res = await post(lineId, { professionalId: w.ana.id });
  expect(res.ok(), await res.text()).toBeTruthy();
  res = await post(lineId, { professionalId: w.bea.id });
  expect(res.status()).toBe(409);
  expect(await res.text()).toContain("COMMISSION_LINE_NOT_ASSIGNABLE");

  const other = await issueInvoice(request, w.adminToken, [{ serviceId: w.service2.id, name: w.service2.name }]);
  const orphans = await apiGetJson<Orphan[]>(request, w.adminToken, "/api/commissions/lines-without-beneficiary");
  const otherLine = orphans.find((o) => o.invoiceId === other.id)!.invoiceLineId;
  await voidInvoice(request, w.adminToken, other.id);
  res = await post(otherLine, { professionalId: w.ana.id });
  expect(res.status()).toBe(409);
  expect(await res.text()).toContain("COMMISSION_LINE_NOT_ASSIGNABLE");
});
