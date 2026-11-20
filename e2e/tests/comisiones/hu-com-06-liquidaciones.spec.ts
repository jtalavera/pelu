import { expect, test } from "@playwright/test";
import { API_BASE, apiGetJson, apiPostJson } from "../../fixtures/api";
import {
  applyChanges,
  enableCommissionsGlobally,
  entriesOfInvoice,
  generateSettlements,
  issueInvoice,
  loginAdminUi,
  openCommissions,
  liquidarRow,
  liquidarTab,
  provisionCommissionWorld,
  restoreCommissionsGlobal,
  todayYmd,
  type CommissionWorld,
} from "../../fixtures/commissions";

/** HU-COM-06 · Gestionar liquidaciones por periodo. */
let w: CommissionWorld;

test.beforeAll(async ({ request }) => {
  await enableCommissionsGlobally(request);
});

test.afterAll(async ({ request }) => {
  await restoreCommissionsGlobal(request);
});

test.beforeEach(async ({ request }) => {
  w = await provisionCommissionWorld(request, "HU-COM-06");
  await applyChanges(request, w.adminToken, [
    { scope: "RULE", serviceId: w.service.id, value: "40" },
    { scope: "DEFAULT_PRODUCT", value: "10" },
  ]);
});

test("Borrador → Aprobada → Pagada desde la UI, con detalle por línea, composición por tipo, ajuste y auditoría", async ({
  page,
  request,
}) => {
  const inv = await issueInvoice(request, w.adminToken, [
    { serviceId: w.service.id, name: w.service.name, professionalId: w.ana.id },
    { serviceId: w.product.id, name: w.product.name, professionalId: w.ana.id },
  ]);
  await entriesOfInvoice(request, w.adminToken, inv.id, 2);

  await loginAdminUi(page, w);
  await openCommissions(page, "settle");
  // HU-COM-15: Liquidar lists every professional with her state; generate Ana's from her row.
  const row = liquidarRow(page, w.ana.name);
  await expect(row).toHaveAttribute("data-status", "UNSETTLED"); // «To generate» is the open tab
  await row.getByTestId("liquidar-row-generate").click();
  await page.getByTestId("liquidar-confirm").click();
  await expect(page.getByTestId("liquidar-notice")).toContainText("1 settlement was generated.");
  // The open tab moves on to «To approve», where her draft is.
  await expect(row).toHaveAttribute("data-status", "DRAFT");
  await row.getByTestId("liquidar-row-detail").click();

  const detail = page.getByTestId("commission-settlement-detail");
  await expect(detail.getByTestId("settlement-line")).toHaveCount(2);
  await expect(detail.getByTestId("settlement-line").first()).toContainText("excl. VAT");
  // HU-COM-32: the sum that makes the total (no more «Subtotals by type and item»).
  await expect(detail.getByTestId("settlement-comp-services")).toContainText("Gs. 40.000");
  await expect(detail.getByTestId("settlement-comp-products")).toContainText("Gs. 10.000");
  await expect(detail.getByTestId("settlement-total")).toContainText("50.000");

  // Adjustment requires a reason (the form lives in a dialog).
  await page.getByTestId("settlement-adjustment-open").click();
  await page.locator("#adj-amount").fill("5000");
  await page.getByTestId("settlement-add-adjustment").click();
  await expect(page.locator("#adj-error")).toContainText("reason is required");
  await page.locator("#adj-reason").fill("Bono por desempeño");
  await page.getByTestId("settlement-add-adjustment").click();
  await expect(detail.getByTestId("settlement-adjustment")).toContainText("Bono por desempeño");
  await expect(detail.getByTestId("settlement-total")).toContainText("55.000");

  await page.getByTestId("settlement-approve").click();
  await page.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
  await expect(detail.getByTestId("settlement-status")).toHaveText("Approved");
  await expect(page.getByTestId("settlement-add-adjustment")).toHaveCount(0); // immutable

  await page.getByTestId("settlement-pay").click();
  await page.locator("#pay-method").selectOption("TRANSFER");
  await page.locator("#pay-ref").fill("OP-778");
  await page.getByTestId("settlement-pay-confirm").click();
  await expect(detail.getByTestId("settlement-status")).toHaveText("Paid");
  await expect(detail).toContainText("Bank transfer");
  await expect(detail).toContainText("OP-778");
  await page.getByTestId("settlement-history-toggle").click();
  const history = detail.getByTestId("settlement-history");
  await expect(history).toContainText("Draft → Approved");
  await expect(history).toContainText("Approved → Paid");
  await expect(history).toContainText(w.adminEmail);
  await expect(page.getByTestId("settlement-more-trigger")).toHaveCount(0); // never void from Paid
});

test("una entrada se liquida una sola vez; solapamiento rechazado; sin entradas no se genera", async ({ request }) => {
  const inv = await issueInvoice(request, w.adminToken, [
    { serviceId: w.service.id, name: w.service.name, professionalId: w.ana.id },
  ]);
  await entriesOfInvoice(request, w.adminToken, inv.id, 1);
  const first = await generateSettlements(request, w.adminToken, [w.ana.id]);
  expect(first).toHaveLength(1);
  const overlap = await request.post(`${API_BASE}/api/commissions/settlements/generate`, {
    headers: { Authorization: `Bearer ${w.adminToken}`, "Content-Type": "application/json" },
    data: { periodFrom: todayYmd(), periodTo: todayYmd(), professionalIds: [w.ana.id] },
  });
  expect(overlap.status()).toBe(409);
  expect(await overlap.text()).toContain("COMMISSION_PERIOD_OVERLAP");
  // Bea has nothing to settle → no settlement.
  expect(await generateSettlements(request, w.adminToken, [w.bea.id])).toHaveLength(0);
});

test("anular una liquidación Borrador libera sus entradas para volver a liquidarlas", async ({ page, request }) => {
  const inv = await issueInvoice(request, w.adminToken, [
    { serviceId: w.service.id, name: w.service.name, professionalId: w.ana.id },
  ]);
  await entriesOfInvoice(request, w.adminToken, inv.id, 1);
  const [s] = await generateSettlements(request, w.adminToken, [w.ana.id]);
  await loginAdminUi(page, w);
  await page.goto(`/app/commissions/settlements/${s.id}`);
  await page.getByTestId("settlement-more-trigger").click();
  await page.getByTestId("settlement-more-item-void").click();
  // HU-COM-19: a draft can be voided without a reason (it is only required once approved).
  await page.getByTestId("settlement-void-confirm").click();
  await expect(page.getByTestId("settlement-status")).toHaveText("Voided");
  const again = await generateSettlements(request, w.adminToken, [w.ana.id]);
  expect(again).toHaveLength(1);
  expect(Number(again[0].totalAmount)).toBe(40000);
});

test("total negativo por ajustes: al aprobar se arrastra el saldo a la próxima liquidación", async ({ request }) => {
  const inv = await issueInvoice(request, w.adminToken, [
    { serviceId: w.service.id, name: w.service.name, professionalId: w.ana.id },
  ]);
  await entriesOfInvoice(request, w.adminToken, inv.id, 1);
  const [s] = await generateSettlements(request, w.adminToken, [w.ana.id]);
  await apiPostJson(request, w.adminToken, `/api/commissions/settlements/${s.id}/adjustments`, {
    amount: -50000,
    reason: "Adelanto",
  });
  const approved = await apiPostJson<{ settlement: { totalAmount: number } }>(
    request,
    w.adminToken,
    `/api/commissions/settlements/${s.id}/approve`,
    {},
  );
  expect(Number(approved.settlement.totalAmount)).toBe(0);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const ymd = tomorrow.toISOString().slice(0, 10);
  const [next] = await generateSettlements(request, w.adminToken, [w.ana.id], ymd, ymd);
  expect(Number(next.totalAmount)).toBe(-10000);
});

test("listado paginado y filtrable por profesional, estado y periodo; exportación CSV", async ({ page, request }) => {
  for (const prof of [w.ana, w.bea]) {
    const inv = await issueInvoice(request, w.adminToken, [
      { serviceId: w.service.id, name: w.service.name, professionalId: prof.id },
    ]);
    await entriesOfInvoice(request, w.adminToken, inv.id, 1);
  }
  const created = await generateSettlements(request, w.adminToken);
  expect(created).toHaveLength(2);
  await apiPostJson(request, w.adminToken, `/api/commissions/settlements/${created[0].id}/approve`, {});
  const paged = await apiGetJson<{ items: unknown[]; total: number }>(
    request,
    w.adminToken,
    "/api/commissions/settlements?page=0&size=1",
  );
  expect(paged.items).toHaveLength(1);
  expect(paged.total).toBe(2);

  await loginAdminUi(page, w);
  await openCommissions(page, "settle");
  // HU-COM-28: the stages of the period are tabs (with their counters), one per state.
  await expect(page.getByTestId("liquidar-tab-APPROVED-count")).toHaveText("1");
  await expect(page.getByTestId("liquidar-tab-DRAFT-count")).toHaveText("1");
  await liquidarTab(page, "APPROVED");
  await expect(page.getByTestId("liquidar-row")).toHaveCount(1);
  await liquidarTab(page, "DRAFT");
  await expect(page.getByTestId("liquidar-row")).toHaveCount(1);
  // HU-COM-30: the download icon opens a menu; «this period» downloads straight away.
  await page.getByTestId("liquidar-csv").click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("liquidar-csv-period").click()]);
  // The file name carries the dates of the period it covers.
  expect(download.suggestedFilename()).toMatch(/^liquidaciones_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/);
});
