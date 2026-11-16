import { expect, test, type Page } from "@playwright/test";
import { API_BASE, apiGetJson } from "../../fixtures/api";
import {
  applyChanges,
  assignToGroup,
  createCatalogItem,
  createGroup,
  createProfessional,
  enableCommissionsGlobally,
  entriesOfInvoice,
  issueInvoice,
  loginAdminUi,
  openCommissions,
  openProfessional,
  openSetupStep,
  provisionCommissionWorld,
  restoreCommissionsGlobal,
  type CommissionWorld,
} from "../../fixtures/commissions";

/**
 * HU-COM-20 · Comisiones con reglas simples
 * (requirements/user_stories/HU-COM-20-comisiones-reglas-simples.md).
 * La conversión de lo existente (AC11, migración V101) se prueba con el test de integración
 * `CommissionRulesConversionTest` del backend: los e2e arrancan con Flyway apagado y sin datos viejos.
 */
let w: CommissionWorld;

test.beforeAll(async ({ request }) => {
  await enableCommissionsGlobally(request);
});

test.afterAll(async ({ request }) => {
  await restoreCommissionsGlobal(request);
});

test.beforeEach(async ({ request }) => {
  w = await provisionCommissionWorld(request, "HU-COM-20");
  await applyChanges(request, w.adminToken, [{ scope: "BASE", value: "TAX_INCLUDED" }]);
});

type Rates = {
  generalServicePercent: number;
  groups: {
    id: number;
    name: string;
    percent: number | null;
    items: { serviceId: number; name: string; ownPercent: number | null; normalPercent: number; source: string; exceptions: { professionalId: number; percent: number }[] }[];
  }[];
  ungrouped: { serviceId: number; name: string; normalPercent: number; source: string }[];
};
const ratesOf = (request: Parameters<typeof apiGetJson>[0]) => apiGetJson<Rates>(request, w.adminToken, "/api/commissions/rates");

async function confirmImmediate(page: Page) {
  await page.getByTestId("commission-apply-mode-IMMEDIATE").check();
  await page.getByTestId("commission-apply-confirm").click();
  await expect(page.getByTestId("commission-apply-dialog")).toHaveCount(0);
}

/** A sale of 100.000 (price with IVA) of `service` by `professionalId`; returns the single entry. */
async function sale(request: Parameters<typeof issueInvoice>[0], service: { id: number; name: string }, professionalId: number) {
  const inv = await issueInvoice(request, w.adminToken, [{ serviceId: service.id, name: service.name, price: 100000, professionalId }]);
  return (await entriesOfInvoice(request, w.adminToken, inv.id, 1))[0];
}

/** Two groups: Corte (3 services, 35 %) and Alisado (2 services, 40 %), plus Gaby and Ana. */
async function salon(request: Parameters<typeof issueInvoice>[0]) {
  const token = w.adminToken;
  const gaby = await createProfessional(request, token, "Gaby");
  const corte = await createGroup(request, token, "Corte");
  const alisado = await createGroup(request, token, "Alisado");
  const cortes = [
    await createCatalogItem(request, token, w, "Corte dama"),
    await createCatalogItem(request, token, w, "Corte caballero"),
    await createCatalogItem(request, token, w, "Corte niño"),
  ];
  const mediano = await createCatalogItem(request, token, w, "Alisado pelo mediano");
  const largo = await createCatalogItem(request, token, w, "Alisado pelo largo");
  await assignToGroup(request, token, corte.id, cortes.map((c) => c.id));
  await assignToGroup(request, token, alisado.id, [mediano.id, largo.id]);
  await applyChanges(request, token, [
    { scope: "GROUP_RULE", groupId: corte.id, value: "35" },
    { scope: "GROUP_RULE", groupId: alisado.id, value: "40" },
  ]);
  return { gaby, corte, alisado, cortes, mediano, largo };
}

// ── AC1 · cuatro capas, gana la última ─────────────────────────────────────────────────────────

test("AC1 · el % sale de cuatro capas, de lo general a lo específico, y gana la última que exista", async ({ request }) => {
  const s = await salon(request);
  const token = w.adminToken;
  const free = await createCatalogItem(request, token, w, "Baño de crema"); // no group
  await applyChanges(request, token, [{ scope: "DEFAULT_SERVICE", value: "10" }]);

  // 1 · general: no group, no % of its own.
  expect(await sale(request, free, s.gaby.id)).toMatchObject({ percentApplied: 10, commissionAmount: 10000, ruleOrigin: "TENANT_DEFAULT_SERVICE" });
  // 2 · the group's.
  expect(await sale(request, s.mediano, s.gaby.id)).toMatchObject({ commissionAmount: 40000, ruleOrigin: "GROUP" });
  // 3 · the service's own % beats its group's.
  await applyChanges(request, token, [{ scope: "RULE", serviceId: s.largo.id, value: "30" }]);
  expect(await sale(request, s.largo, s.gaby.id)).toMatchObject({ commissionAmount: 30000, ruleOrigin: "ITEM" });
  // 4 · hers for that service beats everything; another professional keeps the service's.
  await applyChanges(request, token, [{ scope: "RULE", serviceId: s.largo.id, professionalId: s.gaby.id, value: "50" }]);
  expect(await sale(request, s.largo, s.gaby.id)).toMatchObject({ commissionAmount: 50000, ruleOrigin: "BENEFICIARY_ITEM" });
  expect(await sale(request, s.largo, w.ana.id)).toMatchObject({ commissionAmount: 30000, ruleOrigin: "ITEM" });
  // Her % for one service does not touch her other services of the group.
  expect(await sale(request, s.mediano, s.gaby.id)).toMatchObject({ commissionAmount: 40000, ruleOrigin: "GROUP" });
});

// ── AC2 · AC3 · la retención es de la profesional ──────────────────────────────────────────────

test("AC2 · la retención es de la profesional y sale de la comisión (50 % con retención de 5 % → 45 % y 5 % al aguinaldo)", async ({
  request,
}) => {
  const s = await salon(request);
  const token = w.adminToken;
  await applyChanges(request, token, [
    { scope: "AGUINALDO_ENABLED", value: "true" },
    { scope: "GROUP_RULE", groupId: s.alisado.id, value: "50" },
    { scope: "RETENTION_PROFILE", professionalId: s.gaby.id, value: "5" },
  ]);
  // Hers: 5 points of the 50 go to her fund. Ana does not retain: she is paid the whole 50 %.
  expect(await sale(request, s.mediano, s.gaby.id)).toMatchObject({ commissionAmount: 45000, retentionAmount: 5000, retentionPercent: 5, percentApplied: 45 });
  expect(await sale(request, s.mediano, w.ana.id)).toMatchObject({ commissionAmount: 50000, retentionAmount: 0 });
  // It applies in every layer, also to the general %.
  await applyChanges(request, token, [{ scope: "DEFAULT_SERVICE", value: "20" }]);
  const free = await createCatalogItem(request, token, w, "Baño de crema");
  expect(await sale(request, free, s.gaby.id)).toMatchObject({ commissionAmount: 15000, retentionAmount: 5000 });
  // It is never more than the commission: a 3 % rule retains 3 % and pays nothing.
  await applyChanges(request, token, [{ scope: "RULE", serviceId: free.id, value: "3" }]);
  expect(await sale(request, free, s.gaby.id)).toMatchObject({ commissionAmount: 0, retentionAmount: 3000 });
  // Without aguinaldo on the salon nobody retains.
  await applyChanges(request, token, [{ scope: "AGUINALDO_ENABLED", value: "false" }]);
  expect(await sale(request, s.mediano, s.gaby.id)).toMatchObject({ commissionAmount: 50000, retentionAmount: 0 });
});

test("AC3 · cambiar la retención pregunta desde cuándo aplica y, desde el inicio del período, recalcula lo abierto", async ({ request }) => {
  const s = await salon(request);
  const token = w.adminToken;
  await applyChanges(request, token, [{ scope: "AGUINALDO_ENABLED", value: "true" }]);
  const before = await sale(request, s.mediano, s.gaby.id); // 40 %, no retention yet
  expect(before).toMatchObject({ commissionAmount: 40000, retentionAmount: 0 });
  // It is not a «no question» change any more: without an apply mode the server refuses it.
  await expect(applyChanges(request, token, [{ scope: "RETENTION_PROFILE", professionalId: s.gaby.id, value: "5" }], null)).rejects.toThrow();
  const res = await applyChanges(request, token, [{ scope: "RETENTION_PROFILE", professionalId: s.gaby.id, value: "5" }], "PERIOD_START");
  expect(res.recalculation).toMatchObject({ entriesRecalculated: 1 });
  const net = (await apiGetJson<{ invoiceId: number; commissionAmount: number; retentionAmount: number }[]>(request, token, "/api/commissions/entries")).filter(
    (e) => e.invoiceId === before.invoiceId,
  );
  expect(net.reduce((a, e) => a + e.commissionAmount, 0)).toBe(35000);
  expect(net.reduce((a, e) => a + e.retentionAmount, 0)).toBe(5000);
});

// ── AC4 · AC9 · lo pendiente: un grupo sin su % ────────────────────────────────────────────────

test("AC4 · AC9 · lo único pendiente es un grupo sin su %: se ve en el menú, en Configurar y en «Para revisar», y se resuelve poniéndolo", async ({
  page,
  request,
}) => {
  const s = await salon(request);
  const manos = await createGroup(request, w.adminToken, "Manos");
  await assignToGroup(request, w.adminToken, manos.id, [(await createCatalogItem(request, w.adminToken, w, "Manicura")).id]);
  await sale(request, s.mediano, s.gaby.id); // so the home is not empty
  await loginAdminUi(page, w);
  await openCommissions(page);

  // Home: «Para revisar» says it; the menu counts it.
  await expect(page.getByTestId("home-review-noPercent")).toContainText("1 group without a %");
  await expect(page.getByTestId("commissions-nav-badge-setup")).toHaveText("1");
  await expect(page.getByTestId("home-review-noRules")).toHaveCount(0);
  await page.getByTestId("home-review-noPercent-action").click();
  await expect(page).toHaveURL(/\/configurar\/comisiones$/);

  // The group without its % says «No %» and has the primary button; setting it clears everything.
  const row = page.locator('[data-testid="rates-group"][data-group-name="Manos"]');
  await expect(row.getByTestId("rates-group-percent")).toHaveText("No %");
  await row.getByTestId("rates-group-edit").click();
  await page.getByTestId("rates-percent").fill("30");
  await page.getByTestId("rates-save").click();
  await confirmImmediate(page);
  await expect(row.getByTestId("rates-group-percent")).toHaveText("30 %");
  await expect(page.getByTestId("commissions-nav-badge-setup")).toHaveCount(0);
  await expect(page.getByTestId("rates-notice")).toBeVisible();
});

test("AC4 · una profesional sin nada cargado cobra lo normal y no hay un paso «Reglas por profesional»", async ({ page, request }) => {
  const s = await salon(request);
  await sale(request, s.mediano, w.ana.id);
  await loginAdminUi(page, w);
  await openCommissions(page, "setup");
  await expect(page.getByTestId("config-step-4")).toHaveCount(0);
  await expect(page.getByTestId("commissions-nav-badge-setup")).toHaveCount(0);
  await page.getByTestId("commissions-nav-team").click();
  const ana = page.getByTestId("team-card").filter({ hasText: w.ana.name });
  await expect(ana.getByTestId("team-card-rules")).toHaveText("Paid the usual % of each service");
  await expect(page.getByTestId("team-filter-norules")).toHaveCount(0);
});

// ── AC5 · AC6 · Configurar › Comisiones ────────────────────────────────────────────────────────

test("AC5 · Comisiones: el grupo con su %, el servicio «del grupo» o «propio», quién cobra distinto, poner, cambiar y quitar el % propio", async ({
  page,
  request,
}) => {
  const s = await salon(request);
  await applyChanges(request, w.adminToken, [{ scope: "RULE", serviceId: s.largo.id, professionalId: s.gaby.id, value: "50" }]);
  await loginAdminUi(page, w);
  await page.goto("/app/commissions/configurar/comisiones");
  const alisado = page.locator('[data-testid="rates-group"][data-group-name="Alisado"]');
  await expect(alisado.getByTestId("rates-group-percent")).toHaveText("40 %");
  await alisado.getByTestId("rates-group-toggle").click();
  const item = (name: string) => page.locator(`[data-testid="rates-item"][data-item-name="${name}"]`);

  await expect(item("Alisado pelo mediano")).toHaveAttribute("data-source", "GROUP");
  await expect(item("Alisado pelo mediano").getByTestId("rates-item-percent")).toContainText("from the group");
  // Who is paid differently shows under the service.
  await expect(item("Alisado pelo largo").getByTestId("rates-item-exceptions")).toContainText(/Gaby 50 %/i);

  // «Set its own %» → it starts from what it pays now; the product cost lives under «More options».
  await item("Alisado pelo largo").getByTestId("rates-item-own").click();
  await expect(page.getByTestId("rates-percent")).toHaveValue("40");
  await page.getByTestId("rates-percent").fill("30");
  await page.getByTestId("rates-more-toggle").click();
  await page.getByTestId("rates-fixed").fill("3000");
  await page.getByTestId("rates-destination").selectOption("SALON");
  await page.getByTestId("rates-save").click();
  await confirmImmediate(page);
  await expect(item("Alisado pelo largo")).toHaveAttribute("data-source", "SERVICE");
  await expect(item("Alisado pelo largo").getByTestId("rates-item-percent")).toContainText("own");
  // AC6 · the product cost is deducted from the price before the % (and goes to the salon here).
  const e = await sale(request, s.largo, w.ana.id);
  expect(e).toMatchObject({ fixedAmount: 3000, fixedToProfessional: false, baseAmount: 97000, commissionAmount: 29100 });

  // Change it, then remove it: it goes back to its group's %.
  await item("Alisado pelo largo").getByTestId("rates-item-edit").click();
  await page.getByTestId("rates-percent").fill("35");
  await page.getByTestId("rates-save").click();
  await confirmImmediate(page);
  await expect(item("Alisado pelo largo").getByTestId("rates-item-percent")).toContainText("35 %");
  await item("Alisado pelo largo").getByTestId("rates-item-remove").click();
  await confirmImmediate(page);
  await expect(item("Alisado pelo largo")).toHaveAttribute("data-source", "GROUP");
  expect((await ratesOf(request)).groups.find((g) => g.name === "Alisado")!.items.find((i) => i.name === "Alisado pelo largo")!.ownPercent).toBeNull();
});

test("AC5 · el buscador filtra y abre los grupos donde está lo buscado, y ?q= abre la pantalla ya buscando", async ({ page, request }) => {
  await salon(request);
  await loginAdminUi(page, w);
  await page.goto("/app/commissions/configurar/comisiones?q=largo");
  await expect(page.getByTestId("rates-group")).toHaveCount(1);
  await expect(page.getByTestId("rates-item")).toHaveText(/Alisado pelo largo/);
  await page.getByTestId("rates-search").fill("corte");
  await expect(page.getByTestId("rates-group")).toHaveCount(1);
  await expect(page.locator('[data-testid="rates-group"] [data-testid="rates-item"]')).toHaveCount(3);
});

// ── AC7 · AC8 · la ficha de la profesional ─────────────────────────────────────────────────────

test("AC7 · AC8 · la ficha dice que cobra lo normal; «Todo un grupo» carga una regla por servicio y el grupo se ve junto; cambiar y quitar", async ({
  page,
  request,
}) => {
  const s = await salon(request);
  await loginAdminUi(page, w);
  await openCommissions(page);
  await openProfessional(page, "gaby", "rules");
  await expect(page.getByTestId("pro-rates-usual")).toContainText("is paid the usual % of each service");
  await expect(page.getByTestId("pro-differences-empty")).toBeVisible();
  await expect(page.getByTestId("pro-retention")).toHaveCount(0); // aguinaldo is off

  // Add a whole group: one rule per service the group has today.
  await page.getByTestId("pro-rates-add").click();
  await page.getByTestId("pro-rate-group").selectOption(String(s.corte.id));
  await page.getByTestId("pro-rate-percent-input").fill("40");
  await expect(page.getByTestId("pro-rate-scope")).toContainText("3 services");
  await page.getByTestId("pro-rate-save").click();
  await confirmImmediate(page);
  const rate = page.getByTestId("pro-rate-row");
  await expect(rate).toHaveCount(1);
  await expect(rate.getByTestId("pro-rate-title")).toHaveText("Corte · 3 of 3 services");
  await expect(rate.getByTestId("pro-rate-percent")).toHaveText("40 %");
  await expect(rate.getByTestId("pro-rate-normal")).toHaveText("The usual is 35 %");
  const corte = (await ratesOf(request)).groups.find((g) => g.name === "Corte")!;
  expect(corte.items.every((i) => i.exceptions.some((x) => x.professionalId === s.gaby.id && x.percent === 40))).toBe(true);
  // Her sales in the group are paid 40 %; somebody else's, the usual 35 %.
  expect(await sale(request, s.cortes[0], s.gaby.id)).toMatchObject({ commissionAmount: 40000 });
  expect(await sale(request, s.cortes[0], w.ana.id)).toMatchObject({ commissionAmount: 35000 });

  // A service added to the group later pays the usual %: the page says so and offers to include it.
  const nuevo = await createCatalogItem(request, w.adminToken, w, "Corte con tijera");
  await assignToGroup(request, w.adminToken, s.corte.id, [nuevo.id]);
  await page.reload();
  await expect(rate.getByTestId("pro-rate-title")).toHaveText("Corte · 3 of 4 services");
  await expect(rate.getByTestId("pro-rate-missing")).toContainText("Corte con tijera");
  await rate.getByTestId("pro-rate-include").click();
  await confirmImmediate(page);
  await expect(rate.getByTestId("pro-rate-title")).toHaveText("Corte · 4 of 4 services");

  // Change the % of the whole group, then add one single service, then remove both.
  await rate.getByTestId("pro-rate-edit").click();
  await page.getByTestId("pro-rate-percent-input").fill("45");
  await page.getByTestId("pro-rate-save").click();
  await confirmImmediate(page);
  await expect(rate.getByTestId("pro-rate-percent")).toHaveText("45 %");
  await page.getByTestId("pro-rates-add").click();
  await page.getByTestId("pro-rate-mode-SERVICE").click();
  await page.getByTestId("pro-rate-service").selectOption(String(s.largo.id));
  await page.getByTestId("pro-rate-percent-input").fill("50");
  await page.getByTestId("pro-rate-save").click();
  await confirmImmediate(page);
  await expect(page.getByTestId("pro-rate-row")).toHaveCount(2);
  await expect(page.getByTestId("pro-differences-count")).toHaveText("2 cases");
  await page.getByTestId("pro-rate-row").filter({ hasText: "Alisado pelo largo" }).getByTestId("pro-rate-remove").click();
  await confirmImmediate(page);
  await page.getByTestId("pro-rate-row").filter({ hasText: "Corte" }).getByTestId("pro-rate-remove").click();
  await confirmImmediate(page);
  await expect(page.getByTestId("pro-differences-empty")).toBeVisible();
  expect((await ratesOf(request)).groups.every((g) => g.items.every((i) => i.exceptions.length === 0))).toBe(true);
});

test("AC7 · la retención se ve en la ficha solo con aguinaldo activo, se cambia pidiendo desde cuándo aplica y el ejemplo la descuenta", async ({
  page,
  request,
}) => {
  const s = await salon(request);
  await applyChanges(request, w.adminToken, [
    { scope: "AGUINALDO_ENABLED", value: "true" },
    { scope: "RETENTION_PROFILE", professionalId: s.gaby.id, value: "5" },
  ]);
  await loginAdminUi(page, w);
  await openCommissions(page);
  await openProfessional(page, "gaby", "rules");
  await expect(page.getByTestId("pro-retention-current")).toHaveText("Aguinaldo retention: 5 %");

  // The example takes her retention out of the commission: 45 % of 100.000 → 40.000 paid, 5.000 to the fund.
  await page.getByTestId("pro-rates-add").click();
  await page.getByTestId("pro-rate-group").selectOption(String(s.alisado.id));
  await page.getByTestId("pro-rate-percent-input").fill("45");
  await expect(page.getByTestId("pro-rate-example")).toContainText("40.000");
  await expect(page.getByTestId("pro-rate-example")).toContainText("5.000");
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

  // Changing her retention asks since when it applies.
  await page.getByTestId("pro-retention-edit").click();
  await page.getByTestId("pro-retention-percent").fill("7");
  await page.getByTestId("pro-retention-save").click();
  await confirmImmediate(page);
  await expect(page.getByTestId("pro-retention-current")).toHaveText("Aguinaldo retention: 7 %");
});

// ── AC10 · Grupos y servicios ──────────────────────────────────────────────────────────────────

test("AC10 · la lista de grupos muestra el % de cada uno y la lista «Qué regla gana» va de lo general a lo específico", async ({
  page,
  request,
}) => {
  await salon(request);
  await createGroup(request, w.adminToken, "Manos"); // no % yet
  await loginAdminUi(page, w);
  await openCommissions(page, "setup");
  await openSetupStep(page, 2);
  await page.getByTestId("config-step-2-order-link").click();
  await page.getByTestId("group-row").filter({ hasText: "Manos" }).click();
  await expect(page.getByTestId("group-percent")).toHaveText("No %");
  await page.getByTestId("group-row").filter({ hasText: "Corte" }).click();
  await expect(page.getByTestId("group-percent")).toHaveText("35 %");
  await page.getByTestId("groups-rules-link").click();
  await expect(page).toHaveURL(/\/configurar\/comisiones\?q=Corte$/);
  await expect(page.getByTestId("rates-group")).toHaveCount(1);

  // The exceptions by service: the % of a service without its own is its group's.
  await page.goto("/app/commissions/configurar/grupos?tab=exceptions");
  const order = page.getByTestId("advanced-precedence").getByRole("listitem");
  await expect(order).toHaveText(["Default %", "% of the group", "% of the service", "% of the professional for that service"]);
});

// ── AC12 · API ─────────────────────────────────────────────────────────────────────────────────

test("AC12 · GET /rates trae cada grupo con su %, sus servicios y las excepciones; /overview cuenta los grupos sin %", async ({ request }) => {
  const s = await salon(request);
  const manos = await createGroup(request, w.adminToken, "Manos");
  await applyChanges(request, w.adminToken, [{ scope: "RULE", serviceId: s.largo.id, professionalId: s.gaby.id, value: "55" }]);
  const rates = await ratesOf(request);
  expect(rates.groups.map((g) => [g.name, g.percent])).toEqual([
    ["Alisado", 40],
    ["Corte", 35],
    ["Manos", null],
  ]);
  const largo = rates.groups.find((g) => g.name === "Alisado")!.items.find((i) => i.serviceId === s.largo.id)!;
  expect(largo).toMatchObject({ source: "GROUP", normalPercent: 40, ownPercent: null });
  expect(largo.exceptions).toEqual([expect.objectContaining({ professionalId: s.gaby.id, percent: 55 })]);
  expect(rates.ungrouped.every((i) => i.source === "GENERAL")).toBe(true);

  const overview = await apiGetJson<Record<string, number>>(request, w.adminToken, "/api/commissions/overview");
  expect(overview).toMatchObject({ groupCount: 3, groupsWithoutPercent: 1 });
  expect(overview).not.toHaveProperty("professionalsWithoutRules");
  void manos;
  // The old per-professional rules view is gone.
  const gone = await request.get(`${API_BASE}/api/commissions/professionals/${s.gaby.id}/rules`, {
    headers: { Authorization: `Bearer ${w.adminToken}` },
  });
  expect(gone.ok()).toBe(false);
});
