import { expect, test } from "@playwright/test";
import { API_BASE } from "../../fixtures/api";
import {
  PASSWORD,
  applyChanges,
  enableCommissionsGlobally,
  entriesOfInvoice,
  generateSettlements,
  issueInvoice,
  loginApi,
  professionalWithAccess,
  provisionCommissionWorld,
  restoreCommissionsGlobal,
  setTenantFlag,
  type CommissionWorld,
} from "../../fixtures/commissions";
import { loginAs } from "../../fixtures/auth";

/** HU-COM-07 · Vista del profesional sobre sus comisiones. */
let w: CommissionWorld;
let me: { id: number; email: string };

test.beforeAll(async ({ request }) => {
  await enableCommissionsGlobally(request);
  w = await provisionCommissionWorld(request, "HU-COM-07");
  await applyChanges(request, w.adminToken, [
    { scope: "RULE", serviceId: w.service.id, value: "40" },
    { scope: "DEFAULT_PRODUCT", value: "10" },
  ]);
  me = await professionalWithAccess(request, w.adminToken, "Pro Comisiones");
  const mine = await issueInvoice(request, w.adminToken, [
    { serviceId: w.service.id, name: w.service.name, professionalId: me.id },
    { serviceId: w.product.id, name: w.product.name, professionalId: me.id },
  ]);
  await entriesOfInvoice(request, w.adminToken, mine.id, 2);
  const other = await issueInvoice(request, w.adminToken, [
    { serviceId: w.service.id, name: w.service.name, professionalId: w.ana.id },
  ]);
  await entriesOfInvoice(request, w.adminToken, other.id, 1);
  await generateSettlements(request, w.adminToken, [me.id, w.ana.id]);
});

test.afterAll(async ({ request }) => {
  await restoreCommissionsGlobal(request);
});

test("ve sus comisiones del periodo (servicios y productos) y sus liquidaciones, en solo lectura y con la base usada", async ({
  page,
}) => {
  await loginAs(page, me.email, PASSWORD);
  await page.getByRole("link", { name: "My commissions" }).click();
  await expect(page.getByTestId("my-commissions-total")).toContainText("50.000");
  await expect(page.getByTestId("my-commissions-services")).toContainText("40.000");
  await expect(page.getByTestId("my-commissions-products")).toContainText("10.000");
  const entries = page.getByTestId("my-commissions-entries");
  await expect(entries).toContainText("Excluding VAT");
  await expect(entries.getByRole("button")).toHaveCount(0);
  const settlements = page.getByTestId("my-commissions-settlements");
  await expect(settlements).toContainText("Draft");
  await settlements.getByRole("button", { name: "View" }).click();
  await expect(page.getByTestId("my-settlement-detail")).toContainText("50.000");
});

test("no ve el IVA discriminado ni datos de otros profesionales; los accesos cruzados se rechazan", async ({ request }) => {
  const token = await loginApi(request, me.email);
  const res = await request.get(`${API_BASE}/api/commissions/me`, { headers: { Authorization: `Bearer ${token}` } });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  const entry = body.currentPeriodEntries[0];
  expect(entry).not.toHaveProperty("taxAmount");
  expect(entry).not.toHaveProperty("lineTotal");
  expect(entry).toHaveProperty("baseType");

  for (const path of ["/api/commissions/entries", "/api/commissions/settlements", "/api/commissions/settings"]) {
    const r = await request.get(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    expect(r.status(), path).toBe(403);
  }
  const all = await (
    await request.get(`${API_BASE}/api/commissions/settlements`, { headers: { Authorization: `Bearer ${w.adminToken}` } })
  ).json();
  const anas = all.items.find((s: { professionalId: number }) => s.professionalId === w.ana.id);
  const cross = await request.get(`${API_BASE}/api/commissions/me/settlements/${anas.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(cross.status()).toBe(404);
});

test("con la flag apagada la sección no aparece", async ({ page, request }) => {
  await setTenantFlag(request, w.tenantId, "COMMISSIONS", false);
  try {
    await loginAs(page, me.email, PASSWORD);
    await expect(page.getByRole("link", { name: "My commissions" })).toHaveCount(0);
  } finally {
    await setTenantFlag(request, w.tenantId, "COMMISSIONS", true);
  }
});
