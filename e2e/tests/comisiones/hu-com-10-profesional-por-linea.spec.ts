import { expect, test } from "@playwright/test";
import { API_BASE, apiGetJson, apiPostJson, seedClient } from "../../fixtures/api";
import { clickIssueInvoiceAndExpectSuccess, pickServiceLine } from "../../fixtures/invoice";
import {
  applyChanges,
  enableCommissionsGlobally,
  entriesOfInvoice,
  loginAdminUi,
  provisionCommissionWorld,
  restoreCommissionsGlobal,
  setTenantFlag,
  type CommissionWorld,
} from "../../fixtures/commissions";

/** HU-COM-10 · Asignar profesional / vendedor a las líneas del comprobante (modifica HU-14). */
let w: CommissionWorld;

test.beforeAll(async ({ request }) => {
  await enableCommissionsGlobally(request);
  w = await provisionCommissionWorld(request, "HU-COM-10");
  await applyChanges(request, w.adminToken, [
    { scope: "RULE", serviceId: w.service.id, value: "40" },
    { scope: "DEFAULT_PRODUCT", value: "10" },
  ]);
});

test.afterAll(async ({ request }) => {
  await restoreCommissionsGlobal(request);
});

async function openNewInvoice(page: import("@playwright/test").Page) {
  await page.goto("/app/billing");
  await page.getByRole("tab", { name: "Cash Register" }).click();
  await page.getByRole("button", { name: "New Invoice" }).click();
  await page.getByLabel("Search or select client").click();
  await page.getByRole("button", { name: "Occasional client" }).click();
  await page.getByLabel("Client name / business name").fill("Venta suelta");
}

test("venta suelta: cada línea (servicio y producto) tiene Profesional / Vendedor; asignado genera comisión, vacío avisa sin bloquear", async ({
  page,
  request,
}) => {
  await loginAdminUi(page, w);
  await openNewInvoice(page);
  await pickServiceLine(page, w.product.name, 0);
  // Starts empty and lists only active professionals; empty line shows the warning.
  await expect(page.locator("#line-professional-0")).toHaveValue("");
  await expect(page.getByTestId("line-no-commission-0")).toHaveText("This line will not generate a commission.");
  await page.locator("#line-professional-0").selectOption({ label: w.bea.name });
  await expect(page.getByTestId("line-no-commission-0")).toHaveCount(0);

  await page.getByRole("button", { name: "Add item" }).click();
  await pickServiceLine(page, w.service.name, 1);
  await expect(page.getByTestId("line-no-commission-1")).toBeVisible();

  await page.locator("#pay-amount-0").fill("220000");
  const inv = await clickIssueInvoiceAndExpectSuccess(page);
  const es = await entriesOfInvoice(request, w.adminToken, inv.id, 1);
  expect(es[0].professionalId).toBe(w.bea.id);
  expect(es[0].itemKind).toBe("PRODUCT");

  // Stored on the line and immutable after issue (the invoice API has no line update).
  const detail = await apiGetJson<{ lines: { professionalId: number | null }[] }>(
    request,
    w.adminToken,
    `/api/invoices/${inv.id}`,
  );
  expect(detail.lines.map((l) => l.professionalId)).toEqual([w.bea.id, null]);
});

test("desde una ficha de servicio el profesional se precarga y se puede cambiar", async ({ page, request }) => {
  const client = await seedClient(request, w.adminToken, `Cliente Ficha ${Date.now()}`);
  await apiPostJson(request, w.adminToken, "/api/service-records", {
    clientId: client.id,
    lines: [{ serviceId: w.service.id, professionalId: w.ana.id, quantity: 1, unitPrice: 110000 }],
    tips: [],
  });
  await loginAdminUi(page, w);
  await page.goto("/app/service-records");
  await page.getByRole("tab", { name: "History" }).click();
  await page.locator("#service-record-history-text-filter").fill("Cliente Ficha");
  await page.locator("tbody tr").filter({ hasText: "CLIENTE FICHA" }).first().click();
  await page.getByRole("button", { name: "Generate invoice" }).click();
  await expect(page).toHaveURL(/\/app\/billing/);
  const select = page.locator("#line-professional-0");
  await expect(select).toHaveValue(String(w.ana.id));
  await select.selectOption({ label: w.bea.name });
  const inv = await clickIssueInvoiceAndExpectSuccess(page);
  const [e] = await entriesOfInvoice(request, w.adminToken, inv.id, 1);
  expect(e.professionalId).toBe(w.bea.id);
});

test("un profesional inactivo o de otro tenant se rechaza", async ({ request }) => {
  const other = await apiPostJson<{ id: number }>(request, w.adminToken, "/api/professionals", {
    fullName: `Inactiva ${Date.now()}`,
  });
  const off = await request.post(`${API_BASE}/api/professionals/${other.id}/deactivate`, {
    headers: { Authorization: `Bearer ${w.adminToken}` },
  });
  expect(off.ok()).toBeTruthy();
  const body = (professionalId: number) => ({
    clientId: null,
    clientDisplayName: "X",
    discountType: "NONE",
    lines: [{ serviceId: w.service.id, description: w.service.name, quantity: 1, unitPrice: 110000, professionalId }],
    payments: [{ method: "CASH", amount: 110000 }],
  });
  const inactive = await request.post(`${API_BASE}/api/invoices`, {
    headers: { Authorization: `Bearer ${w.adminToken}`, "Content-Type": "application/json" },
    data: body(other.id),
  });
  expect(inactive.status()).toBe(409);
  expect(await inactive.text()).toContain("INVOICE_LINE_PROFESSIONAL_INACTIVE");
  const foreign = await request.post(`${API_BASE}/api/invoices`, {
    headers: { Authorization: `Bearer ${w.adminToken}`, "Content-Type": "application/json" },
    data: body(999_999),
  });
  expect(foreign.status()).toBe(404);
  expect(await foreign.text()).toContain("PROFESSIONAL_NOT_FOUND");
});

test("con la flag deshabilitada el campo no se muestra y el flujo de HU-14 no cambia", async ({ page, request }) => {
  await setTenantFlag(request, w.tenantId, "COMMISSIONS", false);
  try {
    await loginAdminUi(page, w);
    await openNewInvoice(page);
    await pickServiceLine(page, w.service.name, 0);
    await expect(page.locator("#line-professional-0")).toHaveCount(0);
    await expect(page.getByTestId("line-no-commission-0")).toHaveCount(0);
    await page.locator("#pay-amount-0").fill("110000");
    await clickIssueInvoiceAndExpectSuccess(page);
  } finally {
    await setTenantFlag(request, w.tenantId, "COMMISSIONS", true);
  }
});
