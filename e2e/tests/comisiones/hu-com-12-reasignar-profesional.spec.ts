import { expect, test, type Page } from "@playwright/test";
import { API_BASE, apiGetJson, apiPostJson } from "../../fixtures/api";
import {
  applyChanges,
  enableCommissionsGlobally,
  entries,
  entriesOfInvoice,
  generateSettlements,
  issueInvoice,
  loginAdminUi,
  rowMenuAction,
  provisionCommissionWorld,
  restoreCommissionsGlobal,
  type CommissionWorld,
} from "../../fixtures/commissions";

/** HU-COM-12 · Cambiar el profesional al que se asignó una comisión por error. */
let w: CommissionWorld;
let invoiceId: number;

test.beforeAll(async ({ request }) => {
  await enableCommissionsGlobally(request);
});

test.afterAll(async ({ request }) => {
  await restoreCommissionsGlobal(request);
});

test.beforeEach(async ({ request }) => {
  w = await provisionCommissionWorld(request, "HU-COM-12");
  await applyChanges(request, w.adminToken, [
    { scope: "RULE", serviceId: w.service.id, value: "40" },
    { scope: "RULE", serviceId: w.service.id, professionalId: w.bea.id, value: "50" },
  ]);
  const inv = await issueInvoice(request, w.adminToken, [
    { serviceId: w.service.id, name: w.service.name, professionalId: w.ana.id },
  ]);
  invoiceId = inv.id;
  await entriesOfInvoice(request, w.adminToken, invoiceId, 1);
});

async function reassignTo(page: Page, name: string, reason: string) {
  const dialog = page.getByTestId("reassign-dialog");
  await page.locator("#reassign-professional").selectOption({ label: name });
  await page.locator("#reassign-reason").fill(reason);
  await page.getByTestId("reassign-confirm").click();
  await expect(dialog).toHaveCount(0);
}

test("desde «Movimientos»: valida profesional y motivo, revierte la comisión y genera la del profesional correcto con sus reglas", async ({
  page,
  request,
}) => {
  await loginAdminUi(page, w);
  await page.getByRole("link", { name: "Commissions" }).click();
  await page.getByRole("tab", { name: "Movements" }).click();
  const rows = page.getByTestId("movement-row");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(w.ana.name);
  await expect(rows.first()).toContainText("40.000");

  await rowMenuAction(page, rows.first(), "Change professional");
  const dialog = page.getByTestId("reassign-dialog");
  await expect(dialog).toContainText("The invoice is not modified.");
  await expect(page.getByTestId("reassign-closed-warning")).toHaveCount(0);
  // The current professional is not offered.
  await expect(page.locator("#reassign-professional option", { hasText: w.ana.name })).toHaveCount(0);
  await page.getByTestId("reassign-confirm").click();
  await expect(page.locator("#reassign-error")).toHaveText("Choose a professional from the list.");
  await page.locator("#reassign-professional").selectOption({ label: w.bea.name });
  await page.getByTestId("reassign-confirm").click();
  await expect(page.locator("#reassign-error")).toContainText("Enter the reason for the change");
  await page.locator("#reassign-reason").fill("El servicio lo hizo Bea");
  await page.getByTestId("reassign-confirm").click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Commission reassigned." })).toBeVisible();

  await expect(rows).toHaveCount(3);
  const reversal = rows.filter({ hasText: "Reversal due to professional change" });
  await expect(reversal).toContainText(w.ana.name);
  await expect(reversal).toContainText("El servicio lo hizo Bea");
  await expect(reversal).toContainText("-");
  await expect(rows.filter({ hasText: w.bea.name })).toContainText("50.000");
  // Neither the original (already reversed) nor the reversal can be reassigned again.
  await expect(rows.getByRole("button", { name: /actions/i })).toHaveCount(1);

  const es = await entries(request, w.adminToken);
  const mine = es.filter((e) => e.invoiceId === invoiceId);
  expect(mine).toHaveLength(3);
  const sumOf = (pid: number) =>
    mine.filter((e) => e.professionalId === pid).reduce((s, e) => s + Number(e.commissionAmount), 0);
  expect(sumOf(w.ana.id)).toBe(0);
  expect(sumOf(w.bea.id)).toBe(50000);
  const bea = mine.find((e) => e.professionalId === w.bea.id)!;
  expect(bea.ruleOrigin).toBe("BENEFICIARY_ITEM");
  expect(bea.revision).toBe(2);
});

test("desde el detalle de una liquidación en borrador: la comisión sale del borrador y queda pendiente para el profesional correcto", async ({
  page,
  request,
}) => {
  const [draft] = await generateSettlements(request, w.adminToken, [w.ana.id]);
  await loginAdminUi(page, w);
  await page.goto(`/app/commissions/settlements/${draft.id}`);
  const detail = page.getByTestId("commission-settlement-detail");
  await expect(detail.getByTestId("settlement-total")).toContainText("40.000");
  await rowMenuAction(page, detail.getByTestId("settlement-line").first(), "Change professional");
  await reassignTo(page, w.bea.name, "Asignado por error");
  await expect(detail.getByTestId("settlement-total")).toContainText("Gs. 0");
  await expect(detail.getByTestId("settlement-line").first().getByRole("button", { name: /actions/i })).toHaveCount(0);

  const preview = await apiGetJson<{ total: number }>(
    request,
    w.adminToken,
    `/api/commissions/settlement-preview?professionalId=${w.bea.id}`,
  );
  expect(Number(preview.total)).toBe(50000);
});

test("si la comisión está en una liquidación aprobada, se avisa; esa liquidación no cambia y la corrección va a la próxima", async ({
  page,
  request,
}) => {
  const [s] = await generateSettlements(request, w.adminToken, [w.ana.id]);
  await apiPostJson(request, w.adminToken, `/api/commissions/settlements/${s.id}/approve`, {});
  await loginAdminUi(page, w);
  await page.getByRole("link", { name: "Commissions" }).click();
  await page.getByRole("tab", { name: "Movements" }).click();
  await rowMenuAction(page, page.getByTestId("movement-row").first(), "Change professional");
  await expect(page.getByTestId("reassign-closed-warning")).toBeVisible();
  await reassignTo(page, w.bea.name, "Asignado por error");

  const detail = await apiGetJson<{ settlement: { totalAmount: number; status: string } }>(
    request,
    w.adminToken,
    `/api/commissions/settlements/${s.id}`,
  );
  expect(detail.settlement.status).toBe("APPROVED");
  expect(Number(detail.settlement.totalAmount)).toBe(40000);
  const ana = await apiGetJson<{ total: number }>(
    request,
    w.adminToken,
    `/api/commissions/settlement-preview?professionalId=${w.ana.id}`,
  );
  expect(Number(ana.total)).toBe(-40000);
});

test("API: errores de reasignación con códigos", async ({ request }) => {
  const headers = { Authorization: `Bearer ${w.adminToken}`, "Content-Type": "application/json" };
  const [entry] = await entriesOfInvoice(request, w.adminToken, invoiceId, 1);
  const post = (id: number, data: object) =>
    request.post(`${API_BASE}/api/commissions/entries/${id}/reassign`, { headers, data });

  let res = await post(entry.id, { professionalId: w.ana.id, reason: "x" });
  expect(res.status()).toBe(400);
  expect(await res.text()).toContain("COMMISSION_REASSIGN_SAME_PROFESSIONAL");
  res = await post(entry.id, { professionalId: w.bea.id, reason: " " });
  expect(res.status()).toBe(400);
  expect(await res.text()).toContain("COMMISSION_REASSIGN_REASON_REQUIRED");
  res = await post(999999999, { professionalId: w.bea.id, reason: "x" });
  expect(res.status()).toBe(404);
  expect(await res.text()).toContain("COMMISSION_ENTRY_NOT_FOUND");

  res = await post(entry.id, { professionalId: w.bea.id, reason: "x" });
  expect(res.ok()).toBeTruthy();
  res = await post(entry.id, { professionalId: w.bea.id, reason: "x" });
  expect(res.status()).toBe(409);
  expect(await res.text()).toContain("COMMISSION_ENTRY_NOT_REASSIGNABLE");
});
