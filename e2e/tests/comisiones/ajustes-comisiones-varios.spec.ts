import { expect, test, type Locator, type Page } from "@playwright/test";
import { API_BASE, apiGetJson, apiPostJson } from "../../fixtures/api";
import {
  applyChanges,
  enableCommissionsGlobally,
  entriesOfInvoice,
  generateSettlements,
  issueInvoice,
  loginAdminUi,
  provisionCommissionWorld,
  restoreCommissionsGlobal,
  todayYmd,
  type CommissionWorld,
} from "../../fixtures/commissions";

/**
 * Ajustes de Comisiones: exportaciones en el idioma del usuario, aviso al generar liquidaciones
 * cuando alguien ya tiene una (p. ej. Pagada), selección múltiple de profesionales y «Limpiar
 * filtros» en Liquidaciones / Movimientos, y en Reglas: «Cancelar» en cada edición, ediciones
 * independientes, «No comisiona» por profesional y sin falsos «cambios sin guardar».
 */
let w: CommissionWorld;

test.beforeAll(async ({ request }) => {
  await enableCommissionsGlobally(request);
});

test.afterAll(async ({ request }) => {
  await restoreCommissionsGlobal(request);
});

test.beforeEach(async ({ request }) => {
  w = await provisionCommissionWorld(request, "COM-AJUSTES");
  await applyChanges(request, w.adminToken, [{ scope: "DEFAULT_SERVICE", value: "30" }]);
});

async function accrue(request: Parameters<typeof issueInvoice>[0], professionalId: number) {
  const inv = await issueInvoice(request, w.adminToken, [
    { serviceId: w.service.id, name: w.service.name, professionalId },
  ]);
  await entriesOfInvoice(request, w.adminToken, inv.id, 1);
}

async function openTab(page: Page, name: "Settlements" | "Movements" | "Rules" | "Reports") {
  await page.getByRole("link", { name: "Commissions" }).click();
  await page.getByRole("tab", { name, exact: true }).click();
}

/** Picks options of a design-system MultiSelect (checkbox dropdown) by their visible label. */
async function pickProfessionals(page: Page, inputId: string, names: string[]) {
  await page.locator(`#${inputId}`).click();
  const list = page.getByRole("listbox");
  for (const name of names) await list.getByRole("button", { name }).click();
  await page.keyboard.press("Escape");
}

/** The secondary («con fondo») look every Cancel button now shares. */
async function secondaryBackground(page: Page): Promise<string> {
  return page.evaluate(() => {
    const probe = document.createElement("button");
    probe.className = "bg-primary-lt";
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  });
}

async function expectCancelLook(page: Page, cancel: Locator, rightOf: Locator[]) {
  await expect(cancel).toBeVisible();
  expect(await cancel.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(await secondaryBackground(page));
  const box = (await cancel.boundingBox())!;
  for (const other of rightOf) expect(box.x).toBeLessThan((await other.boundingBox())!.x);
}

test("exportaciones: columnas y valores del CSV y del PDF en el idioma elegido por el usuario", async ({
  page,
  request,
}) => {
  await accrue(request, w.ana.id);
  const [s] = await generateSettlements(request, w.adminToken, [w.ana.id]);
  const auth = { Authorization: `Bearer ${w.adminToken}` };

  const es = await (await request.get(`${API_BASE}/api/commissions/entries.csv?lang=es`, { headers: auth })).text();
  expect(es).toContain("Profesional,Movimiento,Motivo,Comprobante,Ítem,Tipo de ítem,Base de cálculo");
  expect(es).toContain("Servicio,Sin IVA");
  expect(es).not.toContain("item_kind");
  const en = await (await request.get(`${API_BASE}/api/commissions/entries.csv?lang=en`, { headers: auth })).text();
  expect(en).toContain("Professional,Movement,Reason,Invoice,Item,Item type,Calculation base");
  expect(en).toContain("Service,Excluding VAT");
  const settlementsEs = await (
    await request.get(`${API_BASE}/api/commissions/settlements.csv?lang=es`, { headers: auth })
  ).text();
  expect(settlementsEs).toContain("ID liquidación,Profesional,Periodo desde,Periodo hasta,Estado");
  expect(settlementsEs).toContain(",Borrador,");
  const pdf = await request.get(`${API_BASE}/api/commissions/settlements/${s.id}/pdf?lang=en`, { headers: auth });
  expect(pdf.ok()).toBeTruthy();

  // The UI (English in e2e) asks for its own language on every export.
  await loginAdminUi(page, w);
  await openTab(page, "Settlements");
  const [settlementsCsv] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export CSV" }).click(),
  ]);
  const settlementsText = await (await settlementsCsv.createReadStream()).toArray();
  expect(Buffer.concat(settlementsText).toString("utf8")).toContain("Settlement ID,Professional,Period from");

  await page.getByRole("tab", { name: "Reports", exact: true }).click();
  const [entriesCsv] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("commission-export-entries").click(),
  ]);
  const entriesText = Buffer.concat(await (await entriesCsv.createReadStream()).toArray()).toString("utf8");
  expect(entriesText).toContain("Item type,Calculation base");
  expect(entriesText).not.toContain("item_kind");

  const pdfRequest = page.waitForRequest((r) => r.url().includes(`/settlements/${s.id}/pdf`));
  await page.goto(`/app/commissions/settlements/${s.id}`);
  await Promise.all([page.waitForEvent("download"), page.getByTestId("settlement-pdf").click()]);
  expect((await pdfRequest).url()).toContain("lang=en");
});

test("generar para todas con una liquidación Pagada: popup para generar las restantes", async ({ page, request }) => {
  await accrue(request, w.ana.id);
  const [paid] = await generateSettlements(request, w.adminToken, [w.ana.id]);
  await apiPostJson(request, w.adminToken, `/api/commissions/settlements/${paid.id}/approve`, {});
  await apiPostJson(request, w.adminToken, `/api/commissions/settlements/${paid.id}/pay`, {
    paymentMethod: "CASH",
    paidOn: todayYmd(),
    paymentReference: "",
  });
  // New commissions for both after Ana was already paid for the period.
  await accrue(request, w.ana.id);
  await accrue(request, w.bea.id);

  await loginAdminUi(page, w);
  await openTab(page, "Settlements");
  await expect(page.getByTestId("commission-settlement-row")).toHaveCount(1);

  await page.getByTestId("commission-generate-settlements").click();
  const popup = page.getByTestId("settlements-conflict");
  await expect(popup).toBeVisible();
  const row = popup.getByTestId("settlements-conflict-row");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(w.ana.name);
  await expect(row).toContainText("Paid");
  await expect(popup).toContainText("generate the settlement for the remaining professional");

  // «Generate none» closes it without creating anything; Cancel-like option is the leftmost.
  await expectCancelLook(page, page.getByTestId("settlements-conflict-none"), [
    page.getByTestId("settlements-conflict-remaining"),
  ]);
  await page.getByTestId("settlements-conflict-none").click();
  await expect(popup).toHaveCount(0);
  await expect(page.getByTestId("commission-settlement-row")).toHaveCount(1);

  // Again, now generating for the remaining one (Bea) only.
  await page.getByTestId("commission-generate-settlements").click();
  await expect(page.getByTestId("settlements-conflict-remaining")).toHaveText("Generate for the remaining one");
  await page.getByTestId("settlements-conflict-remaining").click();
  await expect(page.getByRole("status").filter({ hasText: "1 settlement generated." })).toBeVisible();
  await expect(page.getByTestId("commission-settlement-row")).toHaveCount(2);
  const list = await apiGetJson<{ items: { professionalId: number; status: string }[] }>(
    request,
    w.adminToken,
    "/api/commissions/settlements",
  );
  expect(list.items.filter((i) => i.professionalId === w.bea.id).map((i) => i.status)).toEqual(["DRAFT"]);
});

test("Liquidaciones: varios profesionales a la vez (generar y filtrar) y «Limpiar filtros»", async ({ page, request }) => {
  await accrue(request, w.ana.id);
  await accrue(request, w.bea.id);
  await loginAdminUi(page, w);
  await openTab(page, "Settlements");

  // Generate for both selected professionals at once.
  await pickProfessionals(page, "settle-professional", [w.ana.name, w.bea.name]);
  await expect(page.locator("#settle-professional")).toHaveValue("2 selected");
  await page.getByTestId("commission-generate-settlements").click();
  await expect(page.getByRole("status").filter({ hasText: "2 settlements generated." })).toBeVisible();
  await expect(page.getByTestId("commission-settlement-row")).toHaveCount(2);

  // Filter by one, then by both.
  await pickProfessionals(page, "settle-filter-professional", [w.ana.name]);
  await expect(page.getByTestId("commission-settlement-row")).toHaveCount(1);
  await expect(page.getByTestId("commission-settlement-row")).toContainText(w.ana.name);
  await pickProfessionals(page, "settle-filter-professional", [w.bea.name]);
  await expect(page.getByTestId("commission-settlement-row")).toHaveCount(2);
  await page.locator("#settle-filter-status").selectOption("PAID");
  await expect(page.getByTestId("commission-settlement-row")).toHaveCount(0);

  await page.getByTestId("settlements-clear-filters").click();
  await expect(page.locator("#settle-filter-professional")).toHaveValue("");
  await expect(page.locator("#settle-filter-status")).toHaveValue("");
  await expect(page.getByTestId("commission-settlement-row")).toHaveCount(2);
  await expect(page.getByTestId("settlements-clear-filters")).toBeDisabled();

  // The API filters by several professionals too.
  const both = await apiGetJson<{ total: number }>(
    request,
    w.adminToken,
    `/api/commissions/settlements?professionalIds=${w.ana.id}&professionalIds=${w.bea.id}`,
  );
  expect(both.total).toBe(2);
});

test("Movimientos: filtro por varios profesionales y «Limpiar filtros»", async ({ page, request }) => {
  await accrue(request, w.ana.id);
  await accrue(request, w.bea.id);
  await loginAdminUi(page, w);
  await openTab(page, "Movements");
  await expect(page.getByTestId("movement-row")).toHaveCount(2);

  await pickProfessionals(page, "mov-professional", [w.ana.name]);
  await page.getByTestId("movements-search").click();
  await expect(page.getByTestId("movement-row")).toHaveCount(1);
  await expect(page.getByTestId("movement-row")).toContainText(w.ana.name);

  await pickProfessionals(page, "mov-professional", [w.bea.name]);
  await page.locator("#mov-query").fill("zzz");
  await page.getByTestId("movements-search").click();
  await expect(page.getByTestId("movement-row")).toHaveCount(0);

  await page.getByTestId("movements-clear-filters").click();
  await expect(page.locator("#mov-professional")).toHaveValue("");
  await expect(page.locator("#mov-query")).toHaveValue("");
  await expect(page.getByTestId("movement-row")).toHaveCount(2);
});

async function openItemPanel(page: Page) {
  await loginAdminUi(page, w);
  await openTab(page, "Rules");
  await page.getByTestId(`rules-row-${w.service.id}`).click();
  return page.getByTestId("rules-panel");
}

test("Reglas: «Cancelar» junto a Aplicar sale de cada edición sin dejar cambios", async ({ page }) => {
  const panel = await openItemPanel(page);

  // Change the item standard → Cancel.
  await panel.getByTestId("rules-change-standard").click();
  await panel.getByTestId("rules-standard-input").fill("70");
  await expectCancelLook(page, panel.getByTestId("rules-standard-cancel"), [panel.getByTestId("rules-standard-apply")]);
  await panel.getByTestId("rules-standard-cancel").click();
  await expect(panel.getByTestId("rules-standard-input")).toHaveCount(0);
  await expect(panel.getByTestId("rules-panel-standard")).toHaveText("30 %");

  // Click a professional → Cancel.
  await panel.getByTestId(`rules-panel-prof-${w.ana.id}`).getByRole("button").first().click();
  await panel.getByTestId("rules-edit-percent").fill("55");
  await expectCancelLook(page, panel.getByTestId("rules-edit-cancel"), [panel.getByTestId("rules-edit-apply")]);
  await panel.getByTestId("rules-edit-cancel").click();
  await expect(panel.getByTestId("rules-edit-percent")).toHaveCount(0);
  await expect(panel.getByTestId(`rules-panel-prof-${w.ana.id}`)).toContainText("Inherits 30 %");

  // Add exception → Cancel.
  await panel.getByTestId("rules-add-exception").click();
  await panel.getByTestId("rules-add-professional").selectOption({ label: w.bea.name });
  await panel.getByTestId("rules-add-percent").fill("60");
  await expectCancelLook(page, panel.getByTestId("rules-add-cancel"), [panel.getByTestId("rules-add-apply")]);
  await panel.getByTestId("rules-add-cancel").click();
  await expect(panel.getByTestId("rules-add-percent")).toHaveCount(0);
  await expect(panel.getByTestId("rules-add-exception")).toBeVisible();

  await expect(page.getByTestId("rules-pending-count")).toHaveCount(0);
  await expect(panel.getByTestId("rules-panel-pending")).toHaveCount(0);
});

test("Reglas: con un profesional abierto, «Agregar excepción» no edita el % del profesional", async ({ page }) => {
  const panel = await openItemPanel(page);
  await panel.getByTestId(`rules-panel-prof-${w.ana.id}`).getByRole("button").first().click();
  await expect(panel.getByTestId("rules-edit-percent")).toHaveValue("30");

  // Opening «Agregar excepción» closes the professional's edit; its input starts empty.
  await panel.getByTestId("rules-add-exception").click();
  await expect(panel.getByTestId("rules-edit-percent")).toHaveCount(0);
  await expect(panel.getByTestId("rules-add-percent")).toHaveValue("");
  await panel.getByTestId("rules-add-percent").fill("60");

  // Re-opening the professional shows its own value, untouched by what was typed for the exception.
  await panel.getByTestId(`rules-panel-prof-${w.ana.id}`).getByRole("button").first().click();
  await expect(panel.getByTestId("rules-edit-percent")).toHaveValue("30");
  await expect(panel.getByTestId("rules-add-percent")).toHaveCount(0);
  await panel.getByTestId("rules-edit-percent").fill("45");
  await panel.getByTestId("rules-add-exception").click();
  await expect(panel.getByTestId("rules-add-percent")).toHaveValue("");
  await expect(page.getByTestId("rules-pending-count")).toHaveCount(0);
});

test("Reglas: un profesional puede quitarse de un servicio («No comisiona») y volver a incluirse", async ({
  page,
  request,
}) => {
  const panel = await openItemPanel(page);
  await panel.getByTestId(`rules-panel-prof-${w.bea.id}`).getByRole("button").first().click();
  await panel.getByTestId("rules-exclude-professional").click();

  await expect(panel.getByTestId(`rules-panel-prof-${w.bea.id}`)).toHaveCount(0);
  const excluded = panel.getByTestId("rules-panel-excluded");
  await expect(excluded).toContainText("No commission (1)");
  await expect(panel.getByTestId(`rules-panel-excluded-${w.bea.id}`)).toContainText(w.bea.name);
  await expect(panel.getByTestId(`rules-panel-excluded-${w.bea.id}`)).toContainText("unsaved");
  await expect(page.getByTestId(`rules-exceptions-${w.service.id}`)).toContainText("no commission");

  await page.getByTestId("rules-panel-save").click();
  await page.getByTestId("commission-apply-mode-IMMEDIATE").check();
  await page.getByTestId("commission-apply-confirm").click();
  await expect(page.getByRole("status").filter({ hasText: "Change applied." })).toBeVisible();

  const inv = await issueInvoice(request, w.adminToken, [
    { serviceId: w.service.id, name: w.service.name, professionalId: w.bea.id },
  ]);
  const [entry] = await entriesOfInvoice(request, w.adminToken, inv.id, 1);
  expect(Number(entry.commissionAmount)).toBe(0);

  // «Volver a incluir» puts her back on the standard %.
  await page.getByTestId(`rules-row-${w.service.id}`).click();
  await panel.getByTestId(`rules-panel-excluded-${w.bea.id}`).getByTestId("rules-include-professional").click();
  await expect(panel.getByTestId("rules-panel-excluded")).toHaveCount(0);
  await expect(panel.getByTestId(`rules-panel-prof-${w.bea.id}`)).toContainText("Inherits 30 %");
  await expect(page.getByTestId("rules-pending-count")).toHaveText("1 unsaved change");
});

test("Reglas: aplicar el mismo % que ya hereda no deja «cambios sin guardar» invisibles", async ({ page }) => {
  const panel = await openItemPanel(page);

  // Same % the professional already inherits → nothing to save, no «±0» exception.
  await panel.getByTestId(`rules-panel-prof-${w.ana.id}`).getByRole("button").first().click();
  await panel.getByTestId("rules-edit-apply").click();
  await expect(panel.getByTestId(`rules-panel-prof-${w.ana.id}`)).toContainText("Inherits 30 %");
  await expect(panel.getByTestId(`rules-panel-prof-${w.ana.id}`)).not.toContainText("±0");
  await expect(panel.getByTestId("rules-panel-pending")).toHaveCount(0);
  await expect(page.getByTestId("rules-pending-count")).toHaveCount(0);

  // Same for an «Agregar excepción» with the inherited % and for the standard itself.
  await panel.getByTestId("rules-add-exception").click();
  await panel.getByTestId("rules-add-professional").selectOption({ label: w.bea.name });
  await panel.getByTestId("rules-add-percent").fill("30");
  await panel.getByTestId("rules-add-apply").click();
  await panel.getByTestId("rules-change-standard").click();
  await panel.getByTestId("rules-standard-apply").click();
  await expect(panel.getByTestId("rules-panel-pending")).toHaveCount(0);
  await expect(page.getByTestId("rules-pending-count")).toHaveCount(0);

  // A real change is marked on its own row, so the warning always points at something visible.
  await panel.getByTestId(`rules-panel-prof-${w.ana.id}`).getByRole("button").first().click();
  await panel.getByTestId("rules-edit-percent").fill("50");
  await panel.getByTestId("rules-edit-apply").click();
  await expect(panel.getByTestId("rules-panel-pending")).toBeVisible();
  await expect(panel.getByTestId(`rules-panel-prof-${w.ana.id}`).getByTestId("rules-panel-unsaved")).toBeVisible();
});
