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
  liquidarRow,
  liquidarTab,
  openCommissions,
  openExceptions,
  openCommissionsMore,
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

/** Opens the exceptions by service or product (HU-COM-16: a tab of Setup › Groups and services). */
async function openAdvanced(page: Page) {
  await openExceptions(page);
}

/** Picks options of a design-system MultiSelect (checkbox dropdown) by their visible label. */
async function pickProfessionals(page: Page, inputId: string, names: string[]) {
  await page.locator(`#${inputId}`).click();
  const list = page.getByRole("listbox");
  for (const name of names) await list.getByRole("button", { name }).click();
  // Escape would also close a dialog: dismiss the list by clicking the dialog title instead.
  const dialog = page.getByRole("dialog");
  if (await dialog.count()) await dialog.getByRole("heading").first().click();
  else await page.keyboard.press("Escape");
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
  await openCommissions(page, "settle");
  const [settlementsCsv] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("liquidar-csv").click(),
  ]);
  const settlementsText = await (await settlementsCsv.createReadStream()).toArray();
  expect(Buffer.concat(settlementsText).toString("utf8")).toContain("Settlement ID,Professional,Period from");

  await page.getByRole("link", { name: "Commissions" }).click();
  await openCommissionsMore(page, "Reports");
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

test("con una liquidación Pagada en el período: «Generar» crea solo las de quienes faltan", async ({ page, request }) => {
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
  await openCommissions(page, "settle");
  await liquidarTab(page, "PAID");
  await expect(liquidarRow(page, w.ana.name)).toHaveAttribute("data-status", "PAID");
  await liquidarTab(page, "UNSETTLED");
  await expect(liquidarRow(page, w.bea.name)).toHaveAttribute("data-status", "UNSETTLED");
  // Paid ones are not offered again: the tab counts only who is missing.
  await expect(page.getByTestId("liquidar-tab-UNSETTLED-count")).toHaveText("1");

  await page.getByTestId("liquidar-main-action").click();
  await expect(page.getByRole("dialog")).toContainText("Generate 1 settlement");
  await page.getByTestId("liquidar-confirm").click();
  await expect(page.getByTestId("liquidar-notice")).toContainText("1 settlement was generated.");
  await expect(liquidarRow(page, w.bea.name)).toHaveAttribute("data-status", "DRAFT");
  const list = await apiGetJson<{ items: { professionalId: number; status: string }[] }>(
    request,
    w.adminToken,
    "/api/commissions/settlements",
  );
  expect(list.items.filter((i) => i.professionalId === w.bea.id).map((i) => i.status)).toEqual(["DRAFT"]);
  expect(list.items.filter((i) => i.professionalId === w.ana.id).map((i) => i.status)).toEqual(["PAID"]);
});

test("Liquidar: varios profesionales a la vez (elegir, generar y ver las pestañas por estado)", async ({ page, request }) => {
  await accrue(request, w.ana.id);
  await accrue(request, w.bea.id);
  await loginAdminUi(page, w);
  await openCommissions(page, "settle");

  // Pick both and generate them at once.
  await liquidarRow(page, w.ana.name).getByTestId("liquidar-row-check").check();
  await liquidarRow(page, w.bea.name).getByTestId("liquidar-row-check").check();
  await expect(page.getByTestId("liquidar-main-action")).toHaveText("Generate 2");
  await page.getByTestId("liquidar-main-action").click();
  await page.getByTestId("liquidar-confirm").click();
  await expect(page.getByTestId("liquidar-notice")).toContainText("2 settlements were generated.");
  await expect(page.getByTestId("liquidar-row")).toHaveCount(2);

  // By stage: both are drafts, nobody is paid yet.
  await liquidarTab(page, "PAID");
  await expect(page.getByTestId("liquidar-row")).toHaveCount(0);
  await expect(page.getByTestId("liquidar-empty")).toBeVisible();
  await liquidarTab(page, "DRAFT");
  await expect(page.getByTestId("liquidar-row")).toHaveCount(2);

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
  await openCommissions(page, "activity");
  await expect(page.getByTestId("movement-row")).toHaveCount(2);

  await page.getByTestId("movements-filters-toggle").click();
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
  await openAdvanced(page);
  await page.getByTestId("rules-kind-SERVICE").click();
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
  await expect(page.getByTestId(`rules-exceptions-${w.service.id}`)).toContainText("1 exception");

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
