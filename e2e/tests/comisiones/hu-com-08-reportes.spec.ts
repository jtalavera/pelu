import { expect, test } from "@playwright/test";
import { API_BASE } from "../../fixtures/api";
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
} from "../../fixtures/commissions";

/** HU-COM-08 · Reportes y exportación. */
let w: CommissionWorld;
let settlementId: number;

test.beforeAll(async ({ request }) => {
  await enableCommissionsGlobally(request);
  w = await provisionCommissionWorld(request, "HU-COM-08");
  await applyChanges(request, w.adminToken, [
    { scope: "RULE", serviceId: w.service.id, value: "40" },
    { scope: "DEFAULT_PRODUCT", value: "10" },
  ]);
  const inv = await issueInvoice(request, w.adminToken, [
    { serviceId: w.service.id, name: w.service.name, professionalId: w.ana.id },
    { serviceId: w.product.id, name: w.product.name, professionalId: w.bea.id },
    { serviceId: w.service2.id, name: w.service2.name, professionalId: null },
  ]);
  await entriesOfInvoice(request, w.adminToken, inv.id, 2);
  [{ id: settlementId }] = await generateSettlements(request, w.adminToken, [w.ana.id]);
});

test.afterAll(async ({ request }) => {
  await restoreCommissionsGlobal(request);
});

test("reportes por profesional, ítem, tipo y periodo con filtros; y líneas sin beneficiario", async ({
  page,
}) => {
  await loginAdminUi(page, w);
  await page.getByRole("link", { name: "Commissions" }).click();
  await page.getByRole("tab", { name: "Reports" }).click();
  await expect(page.getByTestId("commission-report-total")).toContainText("50.000");
  await expect(page.getByTestId("report-by-professional")).toContainText(w.ana.name);
  await expect(page.getByTestId("report-by-professional")).toContainText(w.bea.name);
  await expect(page.getByTestId("report-by-item")).toContainText(w.service.name);
  await expect(page.getByTestId("report-by-kind")).toContainText("Products");
  await expect(page.getByTestId("report-by-period").locator("tbody tr")).toHaveCount(1);
  await expect(page.getByTestId("report-lines-without-beneficiary")).toContainText(w.service2.name);
  // The «ítems sin % general» section was removed from the report (it added no value).
  await expect(page.getByTestId("report-items-without-rule")).toHaveCount(0);

  await page.locator("#report-kind").selectOption("PRODUCT");
  await page.getByTestId("commission-report-search").click();
  await expect(page.getByTestId("commission-report-total")).toContainText("10.000");
  await page.locator("#report-kind").selectOption("");
  await page.locator("#report-state").selectOption("DRAFT");
  await page.getByTestId("commission-report-search").click();
  await expect(page.getByTestId("commission-report-total")).toContainText("40.000");
  await page.locator("#report-state").selectOption("");
  await page.locator("#report-professional").selectOption({ label: w.bea.name });
  await page.getByTestId("commission-report-search").click();
  await expect(page.getByTestId("commission-report-total")).toContainText("10.000");
});

test("exportación CSV de entradas (tipo, base y %) y comprobante PDF de liquidación", async ({ page, request }) => {
  const csv = await request.get(`${API_BASE}/api/commissions/entries.csv`, {
    headers: { Authorization: `Bearer ${w.adminToken}` },
  });
  expect(csv.ok()).toBeTruthy();
  const text = await csv.text();
  expect(text).toContain("item_kind,base_type");
  expect(text).toContain("PRODUCT,NET_OF_TAX");
  expect(text).toContain(",40,40000,");

  const pdf = await request.get(`${API_BASE}/api/commissions/settlements/${settlementId}/pdf`, {
    headers: { Authorization: `Bearer ${w.adminToken}` },
  });
  expect(pdf.ok()).toBeTruthy();
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");

  await loginAdminUi(page, w);
  await page.goto(`/app/commissions/settlements/${settlementId}`);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("settlement-pdf").click()]);
  expect(download.suggestedFilename()).toBe(`liquidacion-${settlementId}.pdf`);
  await page.goto("/app/commissions");
  await page.getByRole("tab", { name: "Reports" }).click();
  const [csvDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("commission-export-entries").click(),
  ]);
  expect(csvDownload.suggestedFilename()).toBe("comisiones.csv");
});
