import { expect, test, type Page } from "@playwright/test";
import { API_BASE, apiGetJson, authHeaders } from "../../fixtures/api";
import {
  applyChanges,
  enableCommissionsGlobally,
  entries,
  issueInvoice,
  loginAdminUi,
  provisionCommissionWorld,
  restoreCommissionsGlobal,
  setTenantFlag,
  voidInvoice,
  type CommissionWorld,
} from "../../fixtures/commissions";

/**
 * "Asignar profesional" en el detalle del comprobante: después de emitir una factura sin
 * profesional en sus servicios, se asigna quién atendió cada uno y se calcula su comisión.
 */
let w: CommissionWorld;
let invoiceId: number;

type InvoiceDetail = {
  invoiceNumberFormatted: string;
  lines: { id: number; serviceId: number | null; professionalId: number | null }[];
};

test.beforeAll(async ({ request }) => {
  await enableCommissionsGlobally(request);
});

test.afterAll(async ({ request }) => {
  await restoreCommissionsGlobal(request);
});

test.beforeEach(async ({ request }) => {
  w = await provisionCommissionWorld(request, "Asignar profesional comprobante");
  await applyChanges(request, w.adminToken, [
    { scope: "RULE", serviceId: w.service.id, value: "40" },
    { scope: "RULE", serviceId: w.service2.id, value: "20" },
  ]);
  const inv = await issueInvoice(request, w.adminToken, [
    { serviceId: w.service.id, name: w.service.name },
    { serviceId: w.service2.id, name: w.service2.name },
  ]);
  invoiceId = inv.id;
});

const invoiceDetail = (request: import("@playwright/test").APIRequestContext) =>
  apiGetJson<InvoiceDetail>(request, w.adminToken, `/api/invoices/${invoiceId}`);

const sumOf = (es: { professionalId: number; commissionAmount: number }[], professionalId: number) =>
  es.filter((e) => e.professionalId === professionalId).reduce((s, e) => s + Number(e.commissionAmount), 0);

const ofInvoice = async (request: import("@playwright/test").APIRequestContext) =>
  (await entries(request, w.adminToken)).filter((e) => e.invoiceId === invoiceId);

async function openInvoiceDetail(page: Page, invoiceNumber: string) {
  await page.goto("/app/billing");
  await page.getByRole("tab", { name: "History" }).click();
  await page
    .locator('tbody tr[role="button"]')
    .filter({ visible: true })
    .filter({ hasText: invoiceNumber })
    .first()
    .click();
}

test("el botón abre un pop up, asigna o cambia profesionales de los servicios emitidos y recalcula sus comisiones", async ({
  page,
  request,
}) => {
  const detail = await invoiceDetail(request);
  const [line1, line2] = detail.lines;
  expect(await ofInvoice(request)).toHaveLength(0); // billed without professionals → no commission

  await loginAdminUi(page, w);
  await openInvoiceDetail(page, detail.invoiceNumberFormatted);
  await page.getByTestId("invoice-assign-professionals-button").click();

  const dialog = page.getByTestId("assign-professionals-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByText("The invoice is not modified.", { exact: false })).toBeVisible();
  await expect(page.getByTestId(`assign-professionals-line-${line1.id}`)).toContainText(w.service.name);
  await expect(page.getByTestId(`assign-professionals-line-${line2.id}`)).toContainText(w.service2.name);

  // Saving with nothing chosen explains the rule with an example.
  await page.getByTestId("assign-professionals-save").click();
  await expect(page.getByTestId("assign-professionals-error")).toContainText(
    "Choose or change the professional of at least one service",
  );

  // Only the first service gets a professional; the second one stays pending.
  await page.locator(`#assign-professional-${line1.id}`).selectOption({ label: w.bea.name });
  // Assigning a pending line isn't a change: no reason field.
  await expect(page.locator("#assign-professionals-reason")).toHaveCount(0);
  await page.getByTestId("assign-professionals-save").click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("invoice-assign-professionals-success")).toContainText(
    "Their commissions were calculated.",
  );

  // Bea's commission: 40 % of the 100.000 net of IVA, unsettled.
  await expect.poll(async () => (await ofInvoice(request)).length, { timeout: 15_000 }).toBe(1);
  const [entry] = await ofInvoice(request);
  expect(entry.professionalId).toBe(w.bea.id);
  expect(entry.serviceId).toBe(w.service.id);
  expect(Number(entry.commissionAmount)).toBe(40000);
  expect(entry.settlementId).toBeNull();

  // Re-opening: the assigned line can be changed too (with an optional reason), and the pending
  // one assigned, in the same save.
  await page.getByTestId("invoice-assign-professionals-button").click();
  await expect(page.getByTestId(`assign-professionals-line-${line1.id}`)).toContainText(
    `Currently assigned: ${w.bea.name}`,
  );
  await expect(page.locator(`#assign-professional-${line1.id}`)).toHaveValue(String(w.bea.id));
  await page.locator(`#assign-professional-${line1.id}`).selectOption({ label: w.ana.name });
  await expect(page.getByTestId("assign-professionals-reassign-note")).toContainText(
    "the correction goes into the next one",
  );
  await page.locator("#assign-professionals-reason").fill("Lo atendió Ana, no Bea");
  await page.locator(`#assign-professional-${line2.id}`).selectOption({ label: w.bea.name });
  await page.getByTestId("assign-professionals-save").click();
  await expect(dialog).toHaveCount(0);

  // Bea's first commission is reversed; Ana earns line 1 (40 %) and Bea line 2 (20 %).
  await expect.poll(async () => (await ofInvoice(request)).length, { timeout: 15_000 }).toBe(4);
  expect(sumOf(await ofInvoice(request), w.ana.id)).toBe(40000);
  expect(sumOf(await ofInvoice(request), w.bea.id)).toBe(20000);

  // The reason is optional: change line 1 back to Bea without one.
  await page.getByTestId("invoice-assign-professionals-button").click();
  await expect(page.locator(`#assign-professional-${line1.id}`)).toHaveValue(String(w.ana.id));
  await page.locator(`#assign-professional-${line1.id}`).selectOption({ label: w.bea.name });
  await page.getByTestId("assign-professionals-save").click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await ofInvoice(request)).length, { timeout: 15_000 }).toBe(6);
  expect(sumOf(await ofInvoice(request), w.ana.id)).toBe(0);
  expect(sumOf(await ofInvoice(request), w.bea.id)).toBe(60000);

  const after = await invoiceDetail(request);
  expect(after.lines.find((l) => l.id === line1.id)!.professionalId).toBe(w.bea.id);
  expect(after.lines.find((l) => l.id === line2.id)!.professionalId).toBe(w.bea.id);
});

test("API: la asignación por lote es todo o nada y valida las líneas", async ({ request }) => {
  const detail = await invoiceDetail(request);
  const [line1, line2] = detail.lines;
  const post = (id: number, data: object) =>
    request.post(`${API_BASE}/api/commissions/invoices/${id}/assign-lines`, {
      headers: authHeaders(w.adminToken),
      data,
    });

  let res = await post(invoiceId, { assignments: [] });
  expect(res.status()).toBe(400);
  expect(await res.text()).toContain("COMMISSION_ASSIGNMENTS_REQUIRED");

  res = await post(invoiceId, {
    assignments: [
      { invoiceLineId: line1.id, professionalId: w.ana.id },
      { invoiceLineId: line1.id, professionalId: w.bea.id },
    ],
  });
  expect(res.status()).toBe(400);
  expect(await res.text()).toContain("COMMISSION_DUPLICATE_LINE");

  // A line of another invoice is rejected — and the valid one before it is rolled back.
  const other = await issueInvoice(request, w.adminToken, [{ serviceId: w.service.id, name: w.service.name }]);
  const otherDetail = await apiGetJson<InvoiceDetail>(request, w.adminToken, `/api/invoices/${other.id}`);
  res = await post(invoiceId, {
    assignments: [
      { invoiceLineId: line1.id, professionalId: w.ana.id },
      { invoiceLineId: otherDetail.lines[0].id, professionalId: w.ana.id },
    ],
  });
  expect(res.status()).toBe(404);
  expect(await res.text()).toContain("INVOICE_LINE_NOT_FOUND");
  expect((await invoiceDetail(request)).lines.every((l) => l.professionalId === null)).toBe(true);
  expect(await ofInvoice(request)).toHaveLength(0);

  res = await post(invoiceId, { assignments: [{ invoiceLineId: line2.id, professionalId: w.bea.id }] });
  expect(res.ok(), await res.text()).toBeTruthy();
  res = await post(invoiceId, { assignments: [{ invoiceLineId: line2.id, professionalId: w.bea.id }] });
  expect(res.status()).toBe(400);
  expect(await res.text()).toContain("COMMISSION_REASSIGN_SAME_PROFESSIONAL");
  // Changing an assigned line works without a reason.
  res = await post(invoiceId, { assignments: [{ invoiceLineId: line2.id, professionalId: w.ana.id }] });
  expect(res.ok(), await res.text()).toBeTruthy();
  await expect.poll(async () => sumOf(await ofInvoice(request), w.ana.id), { timeout: 15_000 }).toBe(20000);
  expect(sumOf(await ofInvoice(request), w.bea.id)).toBe(0);

  // A voided invoice can't be changed.
  await voidInvoice(request, w.adminToken, invoiceId);
  res = await post(invoiceId, { assignments: [{ invoiceLineId: line2.id, professionalId: w.bea.id }] });
  expect(res.status()).toBe(409);
  expect(await res.text()).toContain("COMMISSION_LINE_NOT_ASSIGNABLE");
});

test("una línea con profesional pero sin comisión (módulo apagado al facturar) solo cambia de profesional", async ({
  request,
}) => {
  await setTenantFlag(request, w.tenantId, "COMMISSIONS", false);
  const inv = await issueInvoice(request, w.adminToken, [
    { serviceId: w.service.id, name: w.service.name, professionalId: w.ana.id },
  ]);
  await setTenantFlag(request, w.tenantId, "COMMISSIONS", true);
  const before = await apiGetJson<InvoiceDetail>(request, w.adminToken, `/api/invoices/${inv.id}`);
  const res = await request.post(`${API_BASE}/api/commissions/invoices/${inv.id}/assign-lines`, {
    headers: authHeaders(w.adminToken),
    data: { assignments: [{ invoiceLineId: before.lines[0].id, professionalId: w.bea.id }], note: null },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const after = await apiGetJson<InvoiceDetail>(request, w.adminToken, `/api/invoices/${inv.id}`);
  expect(after.lines[0].professionalId).toBe(w.bea.id);
  expect((await entries(request, w.adminToken)).filter((e) => e.invoiceId === inv.id)).toHaveLength(0);
});

test("el botón no se muestra en un comprobante anulado ni con el módulo de comisiones deshabilitado", async ({
  page,
  request,
}) => {
  const detail = await invoiceDetail(request);
  await setTenantFlag(request, w.tenantId, "COMMISSIONS", false);
  await loginAdminUi(page, w);
  await openInvoiceDetail(page, detail.invoiceNumberFormatted);
  await expect(page.getByRole("button", { name: "Close" }).last()).toBeVisible();
  await expect(page.getByTestId("invoice-assign-professionals-button")).toHaveCount(0);

  await setTenantFlag(request, w.tenantId, "COMMISSIONS", true);
  await voidInvoice(request, w.adminToken, invoiceId);
  await openInvoiceDetail(page, detail.invoiceNumberFormatted);
  await expect(page.getByRole("button", { name: "Close" }).last()).toBeVisible();
  await expect(page.getByTestId("invoice-assign-professionals-button")).toHaveCount(0);
});
