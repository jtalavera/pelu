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
  await page.getByTestId("svc-tab-commission").click();
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
  // Warning badge on items without a general % (shortcut: the row opens the item; its «Commission» tab holds the rules).
  await expect(page.getByTestId(`svc-no-commission-${w.product.id}`)).toBeVisible();
  await page.getByTestId(`svc-row-${w.product.id}`).click();
  await page.getByTestId("svc-tab-commission").click();
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
  await page.getByTestId("svc-tab-commission").click();
  await page.getByText("Rule history").click();
  const history = page.getByTestId("commission-rule-history");
  const firstRow = history.locator("tbody tr").first();
  await expect(firstRow).toContainText("30 %");
  await expect(firstRow).toContainText("35 %");
  await expect(firstRow).toContainText(w.adminEmail);
});

async function openRules(page: Page) {
  await page.getByRole("link", { name: "Commissions" }).click();
  await page.getByRole("tab", { name: "Rules", exact: true }).click();
  await expect(page.getByTestId("rules-table")).toBeVisible();
}

test("vista de reglas: ítems por categoría con precio, % estándar, excepciones con diferencia, contadores y «Ver solo excepciones»", async ({
  page,
  request,
}) => {
  await applyChanges(request, w.adminToken, [
    { scope: "DEFAULT_SERVICE", value: "30" },
    { scope: "RULE", serviceId: w.service.id, value: "40" },
    { scope: "RULE", serviceId: w.service.id, professionalId: w.ana.id, value: "50" },
  ]);
  await loginAdminUi(page, w);
  await openRules(page);

  await expect(page.getByTestId("rules-count-items")).toHaveText("2 services");
  await expect(page.getByTestId("rules-count-exceptions")).toHaveText("1 with exceptions");
  await expect(page.getByTestId("rules-count-professionals")).toHaveText("2 professionals");
  await expect(page.getByText("Calculation base: price excl. VAT.")).toBeVisible();

  const table = page.getByTestId("rules-table");
  // No category grouping rows: one row per item, sorted by name.
  await expect(table.locator("tbody tr", { hasText: "Peluquería" })).toHaveCount(0);
  await expect(table.locator("tbody tr")).toHaveCount(2);
  await expect(page.getByTestId(`rules-row-${w.service.id}`)).toContainText("Gs. 110.000");
  // Item standard differs from the general commission; the professional exception shows its delta.
  await expect(page.getByTestId(`rules-standard-${w.service.id}`)).toContainText("40 %");
  await expect(page.getByTestId(`rules-standard-${w.service.id}`)).toContainText("≠ general");
  await expect(page.getByTestId(`rules-exceptions-${w.service.id}`)).toContainText(/ana/i);
  await expect(page.getByTestId(`rules-exceptions-${w.service.id}`)).toContainText("50 %");
  await expect(page.getByTestId(`rules-exceptions-${w.service.id}`)).toContainText("+10");
  // Without its own %, the item inherits the general commission.
  await expect(page.getByTestId(`rules-standard-${w.service2.id}`)).toHaveText("30 %");
  await expect(page.getByTestId(`rules-exceptions-${w.service2.id}`)).toHaveText("Everyone uses the standard");

  // The Switch input is sr-only: dispatch the click on the input itself (see hu-46).
  // Search by item name (case and accent insensitive) at the top of the table.
  await expect(page.getByLabel("Search service")).toBeVisible();
  await page.getByTestId("rules-search").fill("COLOR");
  await expect(page.getByTestId(`rules-row-${w.service2.id}`)).toBeVisible();
  await expect(page.getByTestId(`rules-row-${w.service.id}`)).toHaveCount(0);
  await page.getByTestId("rules-search").fill("zzz-no-existe");
  await expect(page.getByTestId("rules-empty")).toHaveText("No item matches the search.");
  await page.getByTestId("rules-search").fill("");
  await expect(table.locator("tbody tr")).toHaveCount(2);

  await page.getByTestId("rules-only-exceptions").dispatchEvent("click");
  await expect(page.getByTestId("rules-only-exceptions")).toBeChecked();
  await expect(page.getByTestId(`rules-row-${w.service.id}`)).toBeVisible();
  await expect(page.getByTestId(`rules-row-${w.service2.id}`)).toHaveCount(0);

  await page.getByRole("tab", { name: "Products" }).click();
  await expect(page.getByTestId("rules-count-items")).toHaveText("1 product");
  await expect(page.getByLabel("Search product")).toBeVisible();
  await expect(page.getByTestId("rules-table").locator("tbody tr", { hasText: "Reventa" })).toHaveCount(0);
  await page.getByTestId("rules-search").fill("shamp");
  await page.getByTestId("rules-only-exceptions").dispatchEvent("click");
  await expect(page.getByTestId("rules-only-exceptions")).not.toBeChecked();
  await expect(page.getByTestId(`rules-row-${w.product.id}`)).toBeVisible();

  // «Editar» on the base goes to the general rules.
  await page.getByRole("tab", { name: "Services" }).click();
  await page.getByTestId("rules-edit-base").click();
  await expect(page.getByTestId("rules-general")).toBeVisible();
});

test("panel del ítem: estándar con «Cambiar», % y comisión por profesional, «Agregar excepción»; varios cambios se guardan juntos", async ({
  page,
  request,
}) => {
  await applyChanges(request, w.adminToken, [
    { scope: "DEFAULT_SERVICE", value: "30" },
    { scope: "RULE", serviceId: w.service.id, professionalId: w.ana.id, value: "50" },
  ]);
  await loginAdminUi(page, w);
  await openRules(page);

  await page.getByTestId(`rules-row-${w.service2.id}`).click();
  // The item detail is a dialog centered on the screen.
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const box = (await dialog.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThan(2);
  expect(Math.abs(box.y + box.height / 2 - viewport.height / 2)).toBeLessThan(2);
  const panel = page.getByTestId("rules-panel");
  await expect(dialog).toContainText(w.service2.name);
  await expect(dialog).toContainText("Price Gs. 110.000 · base excl. VAT: Gs. 100.000");
  await expect(panel.getByTestId("rules-panel-standard")).toHaveText("30 %");
  await expect(panel).toContainText("Inherits the general commission (30 %)");
  await expect(panel.getByTestId(`rules-panel-prof-${w.ana.id}`)).toContainText("Inherits 30 %");
  await expect(panel.getByTestId(`rules-panel-prof-${w.ana.id}`)).toContainText("Gs. 30.000");

  // 1) Change the item standard (validated, staged).
  await panel.getByTestId("rules-change-standard").click();
  await panel.getByTestId("rules-standard-input").fill("150");
  await panel.getByTestId("rules-standard-apply").click();
  await expect(panel.getByText(/between 0 and 100.*e\.g\. 40\.5/)).toBeVisible();
  await panel.getByTestId("rules-standard-input").fill("45");
  await panel.getByTestId("rules-standard-apply").click();
  await expect(panel.getByTestId("rules-panel-standard")).toHaveText("45 %");
  await expect(page.getByTestId(`rules-row-${w.service2.id}`)).toContainText("unsaved");
  await expect(page.getByTestId("rules-pending-count")).toHaveText("1 unsaved change");

  // 2) Add an exception for Bea.
  await panel.getByTestId("rules-add-exception").click();
  await panel.getByTestId("rules-add-professional").selectOption({ label: w.bea.name });
  await panel.getByTestId("rules-add-percent").fill("60");
  await panel.getByTestId("rules-add-apply").click();
  await expect(panel.getByTestId(`rules-panel-prof-${w.bea.id}`)).toContainText("60 %");
  await expect(panel.getByTestId(`rules-panel-prof-${w.bea.id}`)).toContainText("+15");
  await expect(panel.getByTestId(`rules-panel-prof-${w.bea.id}`)).toContainText("Gs. 60.000");

  // 3) Close the dialog and edit Ana's exception on the other service.
  await page.getByTestId("rules-panel-close").click();
  await expect(dialog).toHaveCount(0);
  await page.getByTestId(`rules-row-${w.service.id}`).click();
  await panel.getByTestId(`rules-panel-prof-${w.ana.id}`).getByRole("button").first().click();
  await panel.getByLabel(`Percentage for ${w.ana.name}`).fill("55");
  await panel.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByTestId("rules-pending-count")).toHaveText("3 unsaved changes");

  // «Guardar cambios» from the dialog closes it and asks how to apply all pending changes.
  await page.getByTestId("rules-panel-save").click();
  await expect(page.getByTestId("rules-panel")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toContainText("3 rule changes will be saved.");
  await confirmImmediate(page);
  await expect(page.getByRole("status").filter({ hasText: "Change applied." })).toBeVisible();
  await expect(page.getByTestId("rules-pending-count")).toHaveCount(0);
  await expect(page.getByTestId(`rules-standard-${w.service2.id}`)).toContainText("45 %");
  await expect(page.getByTestId(`rules-exceptions-${w.service2.id}`)).toContainText("60 %");
  await expect(page.getByTestId(`rules-exceptions-${w.service.id}`)).toContainText("55 %");

  // Effective on the next invoices (precedence: professional + item > item > general).
  const inv = await issueInvoice(request, w.adminToken, [
    { serviceId: w.service2.id, name: w.service2.name, professionalId: w.ana.id },
    { serviceId: w.service2.id, name: w.service2.name, professionalId: w.bea.id },
    { serviceId: w.service.id, name: w.service.name, professionalId: w.ana.id },
    { serviceId: w.service.id, name: w.service.name, professionalId: w.bea.id },
  ]);
  const es = await entriesOfInvoice(request, w.adminToken, inv.id, 4);
  const pct = (sid: number, pid: number) =>
    es.find((e) => e.professionalId === pid && e.serviceId === sid)!.percentApplied;
  expect(Number(pct(w.service2.id, w.ana.id))).toBe(45);
  expect(Number(pct(w.service2.id, w.bea.id))).toBe(60);
  expect(Number(pct(w.service.id, w.ana.id))).toBe(55);
  expect(Number(pct(w.service.id, w.bea.id))).toBe(30);
});

test("«Descartar» deshace los cambios sin guardar; «Ver historial de cambios» muestra quién y qué cambió", async ({
  page,
  request,
}) => {
  await applyChanges(request, w.adminToken, [{ scope: "RULE", serviceId: w.service.id, value: "30" }]);
  await applyChanges(request, w.adminToken, [{ scope: "RULE", serviceId: w.service.id, value: "35" }]);
  await loginAdminUi(page, w);
  await openRules(page);
  await page.getByTestId(`rules-row-${w.service.id}`).click();
  const panel = page.getByTestId("rules-panel");
  await panel.getByTestId("rules-change-standard").click();
  await panel.getByTestId("rules-standard-input").fill("70");
  await panel.getByTestId("rules-standard-apply").click();
  await expect(page.getByTestId(`rules-standard-${w.service.id}`)).toContainText("70 %");
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await page.getByTestId("rules-discard").click();
  await expect(page.getByTestId(`rules-standard-${w.service.id}`)).toContainText("35 %");
  await expect(page.getByTestId("rules-save")).toBeDisabled();

  await page.getByTestId(`rules-row-${w.service.id}`).click();
  await panel.getByTestId("rules-history").click();
  const history = page.getByTestId("commission-rule-history");
  const firstRow = history.locator("tbody tr").first();
  await expect(firstRow).toContainText("30 %");
  await expect(firstRow).toContainText("35 %");
  await expect(firstRow).toContainText(w.adminEmail);
});

test("la vista muestra el % vigente a una fecha dada y marca los cambios programados", async ({ page, request }) => {
  await applyChanges(request, w.adminToken, [{ scope: "RULE", serviceId: w.service.id, value: "40" }]);
  const scheduled = await applyChanges(request, w.adminToken, [{ scope: "RULE", serviceId: w.service.id, value: "45" }], "NEXT_PERIOD");
  type View = { categories: { items: { serviceId: number; standardPercent: number; scheduled: boolean }[] }[] };
  const find = (v: View) => v.categories.flatMap((c) => c.items).find((i) => i.serviceId === w.service.id)!;
  const today = await apiGetJson<View>(request, w.adminToken, "/api/commissions/rules-view?kind=SERVICE");
  expect(Number(find(today).standardPercent)).toBe(40);
  expect(find(today).scheduled).toBe(true);
  const future = new Date(scheduled.effectiveFrom);
  future.setDate(future.getDate() + 2);
  const ymd = future.toISOString().slice(0, 10);
  const later = await apiGetJson<View>(request, w.adminToken, `/api/commissions/rules-view?kind=SERVICE&date=${ymd}`);
  expect(Number(find(later).standardPercent)).toBe(45);

  await loginAdminUi(page, w);
  await openRules(page);
  await expect(page.getByTestId(`rules-standard-${w.service.id}`)).toContainText("⏱");
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
