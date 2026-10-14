import { expect, test, type Page } from "@playwright/test";
import { API_BASE, apiGetJson } from "../../fixtures/api";
import {
  applyChanges,
  enableCommissionsGlobally,
  entriesOfInvoice,
  issueInvoice,
  loginAdminUi,
  provisionCommissionWorld,
  restoreCommissionsGlobal,
  type CommissionWorld,
} from "../../fixtures/commissions";

/** HU-COM-02 · Definir reglas de comisión por ítem y por profesional. */
let w: CommissionWorld;

test.beforeAll(async ({ request }) => {
  await enableCommissionsGlobally(request);
});

test.afterAll(async ({ request }) => {
  await restoreCommissionsGlobal(request);
});

test.beforeEach(async ({ request }) => {
  w = await provisionCommissionWorld(request, "HU-COM-02");
});

async function confirmImmediate(page: Page) {
  await page.getByTestId("commission-apply-mode-IMMEDIATE").check();
  await page.getByTestId("commission-apply-confirm").click();
  await expect(page.getByTestId("commission-apply-dialog")).toHaveCount(0);
}

test("% general y excepciones por profesional desde la sección «Comisión» del servicio; la excepción prevalece", async ({
  page,
  request,
}) => {
  await loginAdminUi(page, w);
  await page.getByRole("link", { name: "Services" }).click();
  await page.getByTestId(`svc-row-${w.service.id}`).click();
  const section = page.getByTestId("item-commission-section");
  await expect(section).toBeVisible();
  await expect(section.getByTestId("item-commission-no-general")).toBeVisible();

  await page.locator(`#commission-general-${w.service.id}`).fill("40");
  await page.getByTestId("commission-save-general").click();
  await confirmImmediate(page);
  await expect(section.getByTestId("item-commission-no-general")).toHaveCount(0);

  // Two different exceptions for the same item.
  for (const [prof, pct] of [
    [w.ana, "50"],
    [w.bea, "35"],
  ] as const) {
    await page.locator(`#commission-add-exception-${w.service.id}`).selectOption({ label: prof.name });
    await page.locator(`#commission-add-exception-pct-${w.service.id}`).fill(pct);
    await page.getByTestId("commission-add-exception").click();
    await confirmImmediate(page);
  }
  await expect(page.getByTestId("commission-exception-row")).toHaveCount(2);
  // Only active professionals without a current exception are offered.
  await expect(page.locator(`#commission-add-exception-${w.service.id} option`)).toHaveCount(1);

  const inv = await issueInvoice(request, w.adminToken, [
    { serviceId: w.service.id, name: w.service.name, professionalId: w.ana.id },
    { serviceId: w.service.id, name: w.service.name, professionalId: w.bea.id },
  ]);
  const es = await entriesOfInvoice(request, w.adminToken, inv.id, 2);
  expect(es.find((e) => e.professionalId === w.ana.id)!.percentApplied).toBe(50);
  expect(es.find((e) => e.professionalId === w.bea.id)!.percentApplied).toBe(35);
  expect(es.every((e) => e.ruleOrigin === "BENEFICIARY_ITEM")).toBe(true);
});

test("productos: reglas desde la pantalla Productos; sin regla se aplica el % por defecto del tipo", async ({
  page,
  request,
}) => {
  await applyChanges(request, w.adminToken, [
    { scope: "DEFAULT_SERVICE", value: "20" },
    { scope: "DEFAULT_PRODUCT", value: "5" },
  ]);
  const inv = await issueInvoice(request, w.adminToken, [
    { serviceId: w.service.id, name: w.service.name, professionalId: w.ana.id },
    { serviceId: w.product.id, name: w.product.name, professionalId: w.ana.id },
  ]);
  const es = await entriesOfInvoice(request, w.adminToken, inv.id, 2);
  expect(es.find((e) => e.itemKind === "SERVICE")!.ruleOrigin).toBe("TENANT_DEFAULT_SERVICE");
  expect(es.find((e) => e.itemKind === "PRODUCT")!.percentApplied).toBe(5);

  await loginAdminUi(page, w);
  await page.getByRole("link", { name: "Products" }).click();
  // Warning badge on items without a general % (shortcut: the row opens its «Comisión» section).
  await expect(page.getByTestId(`svc-no-commission-${w.product.id}`)).toBeVisible();
  await page.getByTestId(`svc-row-${w.product.id}`).click();
  await page.locator(`#commission-general-${w.product.id}`).fill("12");
  await page.getByTestId("commission-save-general").click();
  await confirmImmediate(page);
  const rules = await apiGetJson<{ generalPercent: number }>(request, w.adminToken, `/api/commissions/items/${w.product.id}/rules`);
  expect(Number(rules.generalPercent)).toBe(12);
});

test("0 % explícito es «sin comisión», distinto de «sin regla»; quitar la regla vuelve al defecto", async ({ request }) => {
  await applyChanges(request, w.adminToken, [
    { scope: "DEFAULT_SERVICE", value: "20" },
    { scope: "RULE", serviceId: w.service.id, value: "0" },
  ]);
  const inv = await issueInvoice(request, w.adminToken, [
    { serviceId: w.service.id, name: w.service.name, professionalId: w.ana.id },
  ]);
  const [zero] = await entriesOfInvoice(request, w.adminToken, inv.id, 1);
  expect(zero.ruleOrigin).toBe("ITEM");
  expect(Number(zero.commissionAmount)).toBe(0);

  await applyChanges(request, w.adminToken, [{ scope: "RULE", serviceId: w.service.id, value: null }]);
  const inv2 = await issueInvoice(request, w.adminToken, [
    { serviceId: w.service.id, name: w.service.name, professionalId: w.ana.id },
  ]);
  const [def] = await entriesOfInvoice(request, w.adminToken, inv2.id, 1);
  expect(def.ruleOrigin).toBe("TENANT_DEFAULT_SERVICE");
  // The rule is closed, not deleted: its history keeps every version.
  const rules = await apiGetJson<{ history: { value: string | null }[] }>(
    request,
    w.adminToken,
    `/api/commissions/items/${w.service.id}/rules`,
  );
  expect(rules.history.map((h) => h.value)).toEqual([null, "0.00"]);
});

test("historial de cambios por regla (quién, valor anterior y nuevo, vigencia)", async ({ page, request }) => {
  await applyChanges(request, w.adminToken, [{ scope: "RULE", serviceId: w.service.id, value: "30" }]);
  await applyChanges(request, w.adminToken, [{ scope: "RULE", serviceId: w.service.id, value: "35" }]);
  await loginAdminUi(page, w);
  await page.getByRole("link", { name: "Services" }).click();
  await page.getByTestId(`svc-row-${w.service.id}`).click();
  await page.getByText("Rule history").click();
  const history = page.getByTestId("commission-rule-history");
  const firstRow = history.locator("tbody tr").first();
  await expect(firstRow).toContainText("30 %");
  await expect(firstRow).toContainText("35 %");
  await expect(firstRow).toContainText(w.adminEmail);
});

test("matriz profesionales × ítems con origen, filtro por tipo, edición de celda y aplicación a varios ítems", async ({
  page,
  request,
}) => {
  await applyChanges(request, w.adminToken, [{ scope: "RULE", serviceId: w.service.id, value: "40" }]);
  await loginAdminUi(page, w);
  await page.getByRole("link", { name: "Commissions" }).click();
  await page.getByRole("tab", { name: "Rules" }).click();
  const matrix = page.getByTestId("commission-matrix");
  await expect(matrix).toBeVisible();
  await expect(page.getByTestId(`commission-cell-${w.service.id}-${w.ana.id}`)).toContainText("40 % (G)");

  await page.locator("#commission-matrix-kind").selectOption("PRODUCT");
  await expect(page.getByTestId("commission-matrix-row")).toHaveCount(1);
  await page.locator("#commission-matrix-kind").selectOption("SERVICE");
  await expect(page.getByTestId("commission-matrix-row")).toHaveCount(2);

  // Cell edit → exception.
  await page.getByTestId(`commission-cell-${w.service.id}-${w.bea.id}`).click();
  await page.locator("#commission-cell-percent").fill("55");
  await page.getByTestId("commission-cell-save").click();
  await confirmImmediate(page);
  await expect(page.getByTestId(`commission-cell-${w.service.id}-${w.bea.id}`)).toContainText("55 % (E)");

  // Bulk: same general % on both services.
  await page.getByLabel(`Select ${w.service.name}`).check();
  await page.getByLabel(`Select ${w.service2.name}`).check();
  await page.locator("#commission-bulk-percent").fill("33");
  await page.getByTestId("commission-bulk-apply").click();
  await confirmImmediate(page);
  await expect(page.getByTestId(`commission-cell-${w.service2.id}-${w.ana.id}`)).toContainText("33 % (G)");
  await expect(page.getByTestId(`commission-cell-${w.service.id}-${w.bea.id}`)).toContainText("55 % (E)");
});

test("la matriz muestra el % efectivo a una fecha dada y marca los cambios programados", async ({ request }) => {
  await applyChanges(request, w.adminToken, [{ scope: "RULE", serviceId: w.service.id, value: "40" }]);
  const scheduled = await applyChanges(request, w.adminToken, [{ scope: "RULE", serviceId: w.service.id, value: "45" }], "NEXT_PERIOD");
  const today = await apiGetJson<{ rows: { serviceId: number; cells: { percent: number; scheduled: boolean }[] }[] }>(
    request,
    w.adminToken,
    "/api/commissions/matrix",
  );
  const row = today.rows.find((r) => r.serviceId === w.service.id)!;
  expect(Number(row.cells[0].percent)).toBe(40);
  expect(row.cells[0].scheduled).toBe(true);
  const future = new Date(scheduled.effectiveFrom);
  future.setDate(future.getDate() + 2);
  const ymd = future.toISOString().slice(0, 10);
  const later = await apiGetJson<typeof today>(request, w.adminToken, `/api/commissions/matrix?date=${ymd}`);
  expect(Number(later.rows.find((r) => r.serviceId === w.service.id)!.cells[0].percent)).toBe(45);
});

test("no se puede crear una excepción para un profesional inactivo; la ya existente se puede cerrar", async ({ request }) => {
  await applyChanges(request, w.adminToken, [{ scope: "RULE", serviceId: w.service.id, professionalId: w.bea.id, value: "50" }]);
  const deactivate = await request.post(`${API_BASE}/api/professionals/${w.bea.id}/deactivate`, {
    headers: { Authorization: `Bearer ${w.adminToken}` },
  });
  expect(deactivate.ok(), await deactivate.text()).toBeTruthy();
  const res = await request.post(`${API_BASE}/api/commissions/changes`, {
    headers: { Authorization: `Bearer ${w.adminToken}`, "Content-Type": "application/json" },
    data: {
      changes: [{ scope: "RULE", serviceId: w.service2.id, professionalId: w.bea.id, value: "50" }],
      applyMode: "IMMEDIATE",
      replacePending: false,
      preview: false,
    },
  });
  expect(res.status()).toBe(409);
  expect(await res.text()).toContain("COMMISSION_PROFESSIONAL_INACTIVE");
  await applyChanges(request, w.adminToken, [{ scope: "RULE", serviceId: w.service.id, professionalId: w.bea.id, value: null }]);
});
