import { expect, test, type Page } from "@playwright/test";
import { API_BASE, apiGetJson, apiPostJson } from "../../fixtures/api";
import {
  applyChanges,
  enableCommissionsGlobally,
  entriesOfInvoice,
  generateSettlements,
  issueInvoice,
  loginAdminUi,
  loginApi,
  professionalWithAccess,
  provisionCommissionWorld,
  restoreCommissionsGlobal,
  type CommissionWorld,
} from "../../fixtures/commissions";

/** HU-COM-09 · Aplicar cambios de cálculo a mitad de periodo (§4.4). */
let w: CommissionWorld;

test.beforeAll(async ({ request }) => {
  await enableCommissionsGlobally(request);
});

test.afterAll(async ({ request }) => {
  await restoreCommissionsGlobal(request);
});

test.beforeEach(async ({ request }) => {
  w = await provisionCommissionWorld(request, "HU-COM-09");
  await applyChanges(request, w.adminToken, [{ scope: "RULE", serviceId: w.service.id, value: "40" }]);
});

async function openItemRules(page: Page) {
  await page.getByRole("link", { name: "Services" }).click();
  await page.getByTestId(`svc-row-${w.service.id}`).click();
  await page.getByTestId("svc-tab-commission").click();
  await expect(page.getByTestId("item-commission-section")).toBeVisible();
}

test("el diálogo ofrece tres opciones, ninguna preseleccionada, con periodo y fechas; no deja aplicar sin elegir", async ({
  page,
  request,
}) => {
  await loginAdminUi(page, w);
  await openItemRules(page);
  await page.locator(`#commission-general-${w.service.id}`).fill("45");
  await page.getByTestId("commission-save-general").click();
  const dialog = page.getByTestId("commission-apply-dialog");
  for (const mode of ["IMMEDIATE", "NEXT_PERIOD", "PERIOD_START"]) {
    await expect(dialog.getByTestId(`commission-apply-mode-${mode}`)).not.toBeChecked();
  }
  await expect(dialog.getByTestId("commission-apply-period")).toContainText("Current period:");
  await expect(dialog.getByText(/Applies from|Scheduled from/).first()).toBeVisible();
  await expect(page.getByTestId("commission-apply-confirm")).toBeDisabled();
  // API side: no mode → COMMISSION_CHANGE_APPLY_MODE_REQUIRED
  const res = await request.post(`${API_BASE}/api/commissions/changes`, {
    headers: { Authorization: `Bearer ${w.adminToken}`, "Content-Type": "application/json" },
    data: { changes: [{ scope: "RULE", serviceId: w.service.id, value: "45" }], applyMode: null, replacePending: false, preview: false },
  });
  expect(res.status()).toBe(400);
  expect(await res.text()).toContain("COMMISSION_CHANGE_APPLY_MODE_REQUIRED");
  // Esc closes without saving.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("«Desde el momento del cambio»: lo anterior conserva su cálculo y el periodo queda mixto", async ({ request }) => {
  const before = await issueInvoice(request, w.adminToken, [
    { serviceId: w.service.id, name: w.service.name, professionalId: w.ana.id },
  ]);
  await entriesOfInvoice(request, w.adminToken, before.id, 1);
  await applyChanges(request, w.adminToken, [{ scope: "BASE", value: "TAX_INCLUDED" }], "IMMEDIATE");
  const after = await issueInvoice(request, w.adminToken, [
    { serviceId: w.service.id, name: w.service.name, professionalId: w.ana.id },
  ]);
  const [old] = await entriesOfInvoice(request, w.adminToken, before.id, 1);
  const [neu] = await entriesOfInvoice(request, w.adminToken, after.id, 1);
  expect(Number(old.commissionAmount)).toBe(40000);
  expect(Number(neu.commissionAmount)).toBe(44000);
  const [s] = await generateSettlements(request, w.adminToken, [w.ana.id]);
  const detail = await apiGetJson<{ mixedBases: boolean }>(request, w.adminToken, `/api/commissions/settlements/${s.id}`);
  expect(detail.mixedBases).toBe(true);
});

test("«Desde el inicio del próximo periodo»: queda programado, no altera el periodo y se puede cancelar", async ({
  page,
  request,
}) => {
  await loginAdminUi(page, w);
  await openItemRules(page);
  await page.locator(`#commission-general-${w.service.id}`).fill("45");
  await page.getByTestId("commission-save-general").click();
  await page.getByTestId("commission-apply-mode-NEXT_PERIOD").check();
  await page.getByTestId("commission-apply-confirm").click();
  await expect(page.getByTestId("commission-scheduled-row")).toHaveCount(1);

  const inv = await issueInvoice(request, w.adminToken, [
    { serviceId: w.service.id, name: w.service.name, professionalId: w.ana.id },
  ]);
  const [e] = await entriesOfInvoice(request, w.adminToken, inv.id, 1);
  expect(Number(e.percentApplied)).toBe(40);

  // Listed in settings with what / current / new / date / author, and cancellable.
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Commissions" }).click();
  await page.getByRole("tab", { name: "Settings" }).click();
  const row = page.getByTestId("commission-scheduled-row");
  await expect(row).toContainText(w.service.name);
  await expect(row).toContainText("40 %");
  await expect(row).toContainText("45 %");
  await expect(row).toContainText(w.adminEmail);
  await row.getByRole("button", { name: "Cancel change" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel change" }).click();
  await expect(page.getByTestId("commission-scheduled-row")).toHaveCount(0);
  await expect(page.getByTestId("commission-settings-history").getByText("Cancelled").first()).toBeVisible();
});

test("un nuevo cambio sobre un alcance con cambio programado lo reemplaza tras confirmación", async ({ page, request }) => {
  await applyChanges(request, w.adminToken, [{ scope: "RULE", serviceId: w.service.id, value: "45" }], "NEXT_PERIOD");
  await loginAdminUi(page, w);
  await openItemRules(page);
  await page.locator(`#commission-general-${w.service.id}`).fill("42");
  await page.getByTestId("commission-save-general").click();
  await page.getByTestId("commission-apply-mode-IMMEDIATE").check();
  await page.getByTestId("commission-apply-confirm").click();
  await expect(page.getByTestId("commission-replace-pending")).toBeVisible();
  await page.getByTestId("commission-apply-confirm").click();
  await expect(page.getByTestId("commission-apply-dialog")).toHaveCount(0);
  const rules = await apiGetJson<{ generalPercent: number; generalScheduled: unknown[] }>(
    request,
    w.adminToken,
    `/api/commissions/items/${w.service.id}/rules`,
  );
  expect(Number(rules.generalPercent)).toBe(42);
  expect(rules.generalScheduled).toHaveLength(0);
});

test("«Desde el inicio del periodo vigente»: vista previa, recálculo con contra-entradas, Borrador actualizado y Aprobada intacta", async ({
  page,
  request,
}) => {
  const anaInv = await issueInvoice(request, w.adminToken, [
    { serviceId: w.service.id, name: w.service.name, professionalId: w.ana.id },
  ]);
  await entriesOfInvoice(request, w.adminToken, anaInv.id, 1);
  const [anaSettlement] = await generateSettlements(request, w.adminToken, [w.ana.id]);
  await apiPostJson(request, w.adminToken, `/api/commissions/settlements/${anaSettlement.id}/approve`, {});
  const beaInv = await issueInvoice(request, w.adminToken, [
    { serviceId: w.service.id, name: w.service.name, professionalId: w.bea.id },
  ]);
  await entriesOfInvoice(request, w.adminToken, beaInv.id, 1);
  const [beaDraft] = await generateSettlements(request, w.adminToken, [w.bea.id]);
  // A manual adjustment in the draft is never recalculated.
  await apiPostJson(request, w.adminToken, `/api/commissions/settlements/${beaDraft.id}/adjustments`, {
    amount: 5000,
    reason: "Bono",
  });

  await loginAdminUi(page, w);
  await openItemRules(page);
  await page.locator(`#commission-general-${w.service.id}`).fill("50");
  await page.getByTestId("commission-save-general").click();
  await page.getByTestId("commission-apply-mode-PERIOD_START").check();
  const preview = page.getByTestId("commission-recalc-preview");
  await expect(preview).toContainText("1 commission will be recalculated.");
  await expect(preview).toContainText("1 commission is left out because it is in an approved or paid settlement.");
  await expect(page.getByTestId("commission-recalc-delta")).toContainText("10.000");
  await page.getByTestId("commission-apply-confirm").click();
  await expect(page.getByTestId("commission-apply-dialog")).toHaveCount(0);

  const approved = await apiGetJson<{ settlement: { totalAmount: number } }>(
    request,
    w.adminToken,
    `/api/commissions/settlements/${anaSettlement.id}`,
  );
  expect(Number(approved.settlement.totalAmount)).toBe(40000);
  const draft = await apiGetJson<{ settlement: { totalAmount: number }; entries: { sourceType: string; reasonCode: string | null; revision: number }[] }>(
    request,
    w.adminToken,
    `/api/commissions/settlements/${beaDraft.id}`,
  );
  expect(Number(draft.settlement.totalAmount)).toBe(55000);
  expect(draft.entries.some((e) => e.sourceType === "REVERSAL" && e.reasonCode === "RECALCULATION")).toBe(true);
  expect(draft.entries.some((e) => e.sourceType === "INVOICE_LINE" && e.revision === 2)).toBe(true);
});

test("con periodicidad manual no hay «próximo periodo»: «Desde el último corte» y «Desde el momento del cambio»", async ({
  page,
  request,
}) => {
  await applyChanges(request, w.adminToken, [{ scope: "PERIODICITY", value: "MANUAL" }], null);
  await loginAdminUi(page, w);
  await openItemRules(page);
  await page.locator(`#commission-general-${w.service.id}`).fill("41");
  await page.getByTestId("commission-save-general").click();
  const dialog = page.getByTestId("commission-apply-dialog");
  await expect(dialog.getByTestId("commission-apply-mode-NEXT_PERIOD")).toHaveCount(0);
  await expect(dialog.getByText("Since the last cutoff")).toBeVisible();
  await expect(dialog.getByText("From the moment of the change")).toBeVisible();
  await expect(dialog.getByTestId("commission-apply-period")).toContainText("Manual periodicity");
});

test("al llegar la fecha, el cambio programado rige sin intervención y sólo para comprobantes nuevos", async ({ request }) => {
  await applyChanges(request, w.adminToken, [{ scope: "RULE", serviceId: w.service.id, value: "45" }], "NEXT_PERIOD");
  // e2e support: stands in for the effective date arriving.
  await apiPostJson(request, w.adminToken, "/api/admin/commission-test-support/make-scheduled-effective", {});
  const inv = await issueInvoice(request, w.adminToken, [
    { serviceId: w.service.id, name: w.service.name, professionalId: w.ana.id },
  ]);
  const [e] = await entriesOfInvoice(request, w.adminToken, inv.id, 1);
  expect(Number(e.percentApplied)).toBe(45);
  const settings = await apiGetJson<{ scheduledChanges: unknown[] }>(request, w.adminToken, "/api/commissions/settings");
  expect(settings.scheduledChanges).toHaveLength(0);
});

test("sólo ADMIN puede aplicar o cancelar cambios: un PROFESSIONAL recibe 403", async ({ request }) => {
  const prof = await professionalWithAccess(request, w.adminToken, "Prof Acceso");
  const token = await loginApi(request, prof.email);
  const res = await request.post(`${API_BASE}/api/commissions/changes`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    data: { changes: [{ scope: "BASE", value: "TAX_INCLUDED" }], applyMode: "IMMEDIATE", replacePending: false, preview: false },
  });
  expect(res.status()).toBe(403);
  const del = await request.delete(`${API_BASE}/api/commissions/changes/1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(del.status()).toBe(403);
});
