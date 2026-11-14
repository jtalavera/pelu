import { expect, test, type Page } from "@playwright/test";
import { API_BASE, apiGetJson, authHeaders } from "../../fixtures/api";
import {
  PASSWORD,
  aguinaldoSummary,
  applyChanges,
  approveSettlementApi,
  assignToGroup,
  createCatalogItem,
  createGroup,
  createProfessional,
  enableCommissionsGlobally,
  entries,
  entriesOfInvoice,
  generateSettlements,
  issueInvoice,
  loginAdminUi,
  openCommissions,
  openCommissionsMore,
  openProfessional,
  liquidarRow,
  professionalWithAccess,
  provisionCommissionWorld,
  restoreCommissionsGlobal,
  voidInvoice,
  type CommissionWorld,
} from "../../fixtures/commissions";
import { loginAs } from "../../fixtures/auth";

/**
 * HU-COM-14 · Comisiones por grupo, retención de aguinaldo y monto fijo por servicio
 * (requirements/user_stories/HU-COM-14-grupos-retencion-aguinaldo-y-monto-fijo.md).
 * Precios con IVA: la base de cálculo se fija en «con IVA», como en el salón.
 */
let w: CommissionWorld;

test.beforeAll(async ({ request }) => {
  await enableCommissionsGlobally(request);
});

test.afterAll(async ({ request }) => {
  await restoreCommissionsGlobal(request);
});

test.beforeEach(async ({ request }) => {
  w = await provisionCommissionWorld(request, "HU-COM-14");
});

type ProRules = {
  aguinaldoEnabled: boolean;
  retentionProfilePercent: number | null;
  groups: {
    groupId: number;
    groupName: string;
    ownRule: boolean;
    percent: number | null;
    retentionPercent: number | null;
    fixedAmount: number | null;
    fixedDestination: string | null;
    serviceCount: number;
  }[];
};

const proRules = (request: Parameters<typeof apiGetJson>[0], id: number) =>
  apiGetJson<ProRules>(request, w.adminToken, `/api/commissions/professionals/${id}/rules`);

/** HU-COM-15: groups live in Setup › step 2; service/product exceptions in Setup › Advanced. */
async function openGroups(page: Page) {
  await loginAdminUi(page, w);
  await openCommissions(page, "setup");
  await page.getByTestId("config-step-2-link").click();
  await expect(page.getByTestId("commission-groups")).toBeVisible();
}

async function openAdvanced(page: Page, kind: "SERVICE" | "PRODUCT" = "SERVICE") {
  await loginAdminUi(page, w);
  await openCommissions(page, "setup");
  await page.getByTestId("config-advanced-link").click();
  await page.getByTestId(`rules-kind-${kind}`).click();
}

/** Opens a professional's «Reglas» tab (Equipo › her page). */
async function openRulesOf(page: Page, name: string) {
  await loginAdminUi(page, w);
  await openCommissions(page);
  await openProfessional(page, name, "rules");
  await expect(page.getByTestId("pro-rules")).toBeVisible();
}

async function confirmImmediate(page: Page) {
  await page.getByTestId("commission-apply-mode-IMMEDIATE").check();
  await page.getByTestId("commission-apply-confirm").click();
  await expect(page.getByTestId("commission-apply-dialog")).toHaveCount(0);
}

/** Salon world: TAX_INCLUDED, aguinaldo ON, groups Brushing / Pestañas / Manos / Producto. */
async function salon(request: Parameters<typeof apiGetJson>[0]) {
  const token = w.adminToken;
  const gaby = await createProfessional(request, token, "Gaby");
  const migue = await createProfessional(request, token, "Migue");
  const jorgelina = await createProfessional(request, token, "Jorgelina");
  const brushing = await createCatalogItem(request, token, w, "Brushing pelo largo");
  const lashes = await createCatalogItem(request, token, w, "Pestañas pelo a pelo");
  const manos = await createCatalogItem(request, token, w, "Manos semipermanente");
  const gBrushing = await createGroup(request, token, "Brushing");
  const gLashes = await createGroup(request, token, "Pestañas");
  const gManos = await createGroup(request, token, "Manos");
  await assignToGroup(request, token, gBrushing.id, [brushing.id]);
  await assignToGroup(request, token, gLashes.id, [lashes.id]);
  await assignToGroup(request, token, gManos.id, [manos.id]);
  await applyChanges(request, token, [
    { scope: "BASE", value: "TAX_INCLUDED" },
    { scope: "AGUINALDO_ENABLED", value: "true" },
    { scope: "AGUINALDO_DEFAULT", value: "5" },
    { scope: "RETENTION_PROFILE", professionalId: gaby.id, value: "5" },
    { scope: "RETENTION_PROFILE", professionalId: migue.id, value: "5" },
    { scope: "GROUP_RULE", groupId: gBrushing.id, professionalId: gaby.id, value: "45|5|0|" },
    { scope: "GROUP_RULE", groupId: gLashes.id, professionalId: gaby.id, value: "45|5|20000|P" },
    { scope: "GROUP_RULE", groupId: gManos.id, professionalId: migue.id, value: "45|5|3000|P" },
    { scope: "GROUP_RULE", groupId: gManos.id, professionalId: jorgelina.id, value: "50|0|3000|P" },
  ]);
  return { gaby, migue, jorgelina, brushing, lashes, manos, gBrushing, gLashes, gManos };
}

// ── AC1 · AC2 · Grupos ────────────────────────────────────────────────────────────────────────

test("AC1 · crear, renombrar y eliminar grupos: nombre obligatorio y sin repetir; con reglas no se elimina", async ({
  page,
  request,
}) => {
  const svc = await createCatalogItem(request, w.adminToken, w, "Brushing corto");
  await openGroups(page);
  const groups = page.getByTestId("commission-groups");

  await groups.getByTestId("groups-new").click();
  await page.getByTestId("groups-save").click();
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveText("Enter the group name, for example Brushing.");
  await page.getByTestId("groups-name").fill("Brushing");
  await page.getByTestId("groups-save").click();
  await expect(page.getByTestId("groups-notice")).toHaveText("The group was created.");
  const row = page.getByTestId("group-row").filter({ hasText: "Brushing" });
  await expect(row).toContainText("0 services");

  await groups.getByTestId("groups-new").click();
  await page.getByTestId("groups-name").fill(" brushing ");
  await page.getByTestId("groups-save").click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("A group with that name already exists");
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

  // Rename.
  await row.getByRole("button", { name: "Actions for group Brushing" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByTestId("groups-name").fill("Brushing y secado");
  await page.getByTestId("groups-save").click();
  await expect(page.getByTestId("groups-notice")).toHaveText("The group was renamed.");
  const renamed = page.getByTestId("group-row").filter({ hasText: "Brushing y secado" });
  await expect(renamed).toBeVisible();

  // Delete an unused group.
  await renamed.getByRole("button", { name: "Actions for group Brushing y secado" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByTestId("groups-notice")).toHaveText("The group was deleted.");
  await expect(page.getByTestId("group-row")).toHaveCount(0);
  await expect(page.getByTestId("groups-empty")).toBeVisible();

  // A group with rules cannot be deleted: its history stays.
  const g = await createGroup(request, w.adminToken, "Con reglas");
  await assignToGroup(request, w.adminToken, g.id, [svc.id]);
  await applyChanges(request, w.adminToken, [
    { scope: "GROUP_RULE", groupId: g.id, professionalId: w.ana.id, value: "40" },
  ]);
  await page.reload();
  await expect(page.getByTestId("commission-groups")).toBeVisible();
  const withRules = page.getByTestId("group-row").filter({ hasText: "Con reglas" });
  await expect(withRules).toContainText("1 service");
  // The row menu opens under its button: bring the row to the middle of the screen first.
  await withRules.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await withRules.getByRole("button", { name: "Actions for group Con reglas" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "has rules and cannot be deleted" })).toBeVisible();
  await expect(withRules).toBeVisible();
});

test("AC2 · servicios sin grupo: sugerencia por nombre, aceptar una, aceptar todas, elegir a mano y productos en la misma pantalla", async ({
  page,
  request,
}) => {
  const token = w.adminToken;
  await createCatalogItem(request, token, w, "Brushing pelo largo");
  await createCatalogItem(request, token, w, "Baño de crema");
  await createCatalogItem(request, token, w, "Aplicación de ampolla");
  await createCatalogItem(request, token, w, "Maquillaje");
  const gBrushing = await createGroup(request, token, "Brushing");
  const gTratamiento = await createGroup(request, token, "Tratamiento");
  const gOtros = await createGroup(request, token, "Otros");
  await createCatalogItem(request, token, w, "Shampoo grande", { kind: "PRODUCT" });
  await openGroups(page);

  const rowOf = (name: string) => page.getByTestId("groups-row").and(page.locator(`[data-name="${name}"]`));
  await expect(rowOf("Brushing pelo largo").getByTestId("groups-suggestion")).toHaveText(
    "Suggested: Brushing · contains «brushing»",
  );
  await expect(rowOf("Baño de crema").getByTestId("groups-suggestion")).toHaveText(
    "Suggested: Tratamiento · contains «bano de crema»",
  );
  await expect(rowOf("Aplicación de ampolla").getByTestId("groups-suggestion")).toHaveText(
    "Suggested: Tratamiento · contains «apli»",
  );
  await expect(rowOf("Maquillaje").getByTestId("groups-suggestion")).toHaveCount(0);

  // Accept one.
  await rowOf("Brushing pelo largo").getByTestId("groups-accept").click();
  await expect(page.getByTestId("groups-notice")).toHaveText("1 service assigned.");
  await expect(rowOf("Brushing pelo largo")).toHaveCount(0); // «No group» view: it has one now

  // Accept all: only the ones with a suggestion.
  await expect(page.getByTestId("groups-accept-all")).toHaveText("Accept the 2 suggestions");
  await page.getByTestId("groups-accept-all").click();
  await expect(page.getByTestId("groups-notice")).toHaveText("2 services assigned.");
  await expect(rowOf("Baño de crema")).toHaveCount(0);
  await expect(rowOf("Aplicación de ampolla")).toHaveCount(0);
  await expect(rowOf("Maquillaje")).toBeVisible();
  await expect(page.getByTestId("groups-accept-all")).toHaveCount(0);

  // Pick one by hand.
  await rowOf("Maquillaje").getByTestId("groups-row-select").selectOption({ label: "Otros" });
  await expect(page.getByTestId("groups-notice")).toHaveText("1 service assigned.");
  const groups = await apiGetJson<{ id: number; serviceCount: number }[]>(request, token, "/api/commissions/groups");
  expect(groups.find((g) => g.id === gBrushing.id)?.serviceCount).toBe(1);
  expect(groups.find((g) => g.id === gTratamiento.id)?.serviceCount).toBe(2);
  expect(groups.find((g) => g.id === gOtros.id)?.serviceCount).toBe(1);

  // Products are in the same screen and are assigned together.
  await page.getByTestId("groups-kind-PRODUCT").click();
  await expect(page.getByTestId("groups-kind-PRODUCT")).toHaveText("Products · 2");
  await page.getByTestId("groups-select-all").check();
  await expect(page.getByTestId("groups-selected")).toHaveText("2 selected");
  await page.getByTestId("groups-bulk-select").selectOption({ label: "Otros" });
  await page.getByTestId("groups-bulk-assign").click();
  await expect(page.getByTestId("groups-notice")).toHaveText("2 products assigned.");
  await expect(page.getByTestId("groups-no-matches")).toBeVisible(); // none left without a group
  await expect(page.getByTestId("groups-bulk-bar")).toHaveCount(0);
});

test("AC2 · buscar, filtrar y asignar en lote; crear un grupo al asignar; mover y quitar de un grupo", async ({ page, request }) => {
  const token = w.adminToken;
  const names = ["Pestañas pelo a pelo", "Pestañas volumen", "Lifting de pestañas", "Corte dama"];
  const items = [];
  for (const n of names) items.push(await createCatalogItem(request, token, w, n));
  const gCorte = await createGroup(request, token, "Corte");
  await assignToGroup(request, token, gCorte.id, [items[3].id]);
  await openGroups(page);
  const rowOf = (name: string) => page.getByTestId("groups-row").and(page.locator(`[data-name="${name}"]`));

  // «+ Nuevo grupo» is at the top; the scope chips count what is in each view.
  await expect(page.getByTestId("groups-new")).toBeVisible();
  await expect(page.getByTestId("groups-scope-GROUPED")).toHaveText("With group · 1");
  await expect(rowOf("Corte dama")).toHaveCount(0); // «No group» is the starting view
  await page.getByTestId("groups-scope-ALL").click();
  await expect(rowOf("Corte dama")).toBeVisible();
  await expect(rowOf("Corte dama").getByTestId("groups-row-chip")).toHaveText("Corte");

  // Search by name (accents and case do not matter), select what matches and create the group on the spot.
  await page.getByTestId("groups-scope-UNGROUPED").click();
  await page.getByTestId("groups-search").fill("PESTANAS");
  await expect(page.getByTestId("groups-row")).toHaveCount(3);
  await page.getByTestId("groups-search").press("Enter"); // Enter in the search field submits the form, nothing breaks
  await expect(page.getByTestId("groups-row")).toHaveCount(3);
  await rowOf("Pestañas pelo a pelo").getByTestId("groups-row-check").check();
  await rowOf("Pestañas volumen").getByTestId("groups-row-check").check();
  await expect(page.getByTestId("groups-selected")).toHaveText("2 selected");
  await page.getByTestId("groups-bulk-select").selectOption({ label: "+ Create new group…" });
  await expect(page.getByTestId("groups-assign-selected")).toBeChecked();
  await page.getByTestId("groups-save").click();
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveText("Enter the group name, for example Brushing.");
  await page.getByTestId("groups-name").fill("Pestañas");
  await page.getByTestId("groups-save").click();
  await expect(page.getByTestId("groups-notice")).toHaveText("The group was created and the selected items were assigned.");
  await expect(page.getByTestId("groups-bulk-bar")).toHaveCount(0);
  await expect(page.getByTestId("groups-row")).toHaveCount(1); // only «Lifting de pestañas» is left without a group
  await expect(rowOf("Lifting de pestañas")).toBeVisible();
  const lashes = (await apiGetJson<{ id: number; name: string; serviceCount: number }[]>(request, token, "/api/commissions/groups")).find(
    (g) => g.name === "Pestañas",
  )!;
  expect(lashes.serviceCount).toBe(2);

  // Tapping a group in the list filters its services; the group filter does the same.
  await page.getByTestId("groups-search").fill("");
  await page.getByRole("button", { name: "Show the services of group Pestañas" }).click();
  await expect(page.getByTestId("groups-group-filter")).toHaveValue(String(lashes.id));
  await expect(page.getByTestId("groups-row")).toHaveCount(2);
  await expect(page.getByTestId("groups-row-chip").first()).toHaveText("Pestañas");

  // Move one to another group and take another out of its group.
  await rowOf("Pestañas volumen").getByTestId("groups-row-select").selectOption({ label: "Corte" });
  await expect(page.getByTestId("groups-notice")).toHaveText("1 service assigned.");
  await expect(rowOf("Pestañas volumen")).toHaveCount(0); // it left the filtered group
  await rowOf("Pestañas pelo a pelo").getByTestId("groups-row-select").selectOption({ label: "Remove from group" });
  await expect(page.getByTestId("groups-notice")).toHaveText("1 item removed from its group.");
  const after = await apiGetJson<{ name: string; serviceCount: number }[]>(request, token, "/api/commissions/groups");
  expect(after.find((g) => g.name === "Corte")?.serviceCount).toBe(2);
  expect(after.find((g) => g.name === "Pestañas")?.serviceCount).toBe(0);

  // A search with no results says so.
  await page.getByTestId("groups-group-filter").selectOption("");
  await page.getByTestId("groups-search").fill("zzz");
  await expect(page.getByTestId("groups-no-matches")).toHaveText("No item matches the search and the filters.");
});

// ── AC3 · AC4 · AC5 · AC6 · AC7 · Reglas por profesional ──────────────────────────────────────

test("AC3 · AC4 · la ficha de la profesional cuenta cada regla en una frase; editar, agregar y quitar preguntan «desde cuándo»", async ({
  page,
  request,
}) => {
  const s = await salon(request);
  await openRulesOf(page, "gaby");
  await expect(page.getByTestId("pro-name")).toHaveText(/^gaby$/i);
  await expect(page.getByTestId("pro-rules-retains")).toHaveText("Retains 5 % for aguinaldo");
  const cards = page.getByTestId("rule-card");
  await expect(cards).toHaveCount(2);
  const brushing = cards.filter({ hasText: "Brushing" });
  await expect(brushing.getByTestId("rule-card-sentence")).toHaveText("Earns 45 % · withholds 5 % for aguinaldo");
  const lashes = cards.filter({ hasText: "Pestañas" });
  await expect(lashes.getByTestId("rule-card-sentence")).toContainText("product cost");
  await expect(lashes.getByTestId("rule-card-sentence")).toContainText("20.000");
  await expect(lashes.getByTestId("rule-card-sentence")).toContainText("(for her)");

  // Edit: the editor asks the numbers; «Next →» asks since when it applies.
  await brushing.getByTestId("rule-card-edit").click();
  await expect(page.getByTestId("rule-paid")).toHaveValue("45");
  await expect(page.getByTestId("rule-retention")).toHaveValue("5");
  await page.getByTestId("rule-paid").fill("50");
  await page.getByTestId("rule-editor-next").click();
  await expect(page.getByTestId("commission-apply-dialog")).toBeVisible();
  await confirmImmediate(page);
  await expect(page.getByRole("status").filter({ hasText: "Change applied." })).toBeVisible();
  const saved = (await proRules(request, s.gaby.id)).groups.find((g) => g.groupId === s.gBrushing.id)!;
  expect(saved.percent).toBe(50);
  expect(saved.retentionPercent).toBe(5);
  await expect(brushing.getByTestId("rule-card-sentence")).toContainText("Earns 50 %");

  // «Add a rule» offers only the groups she has no rule for; her usual retention is prefilled.
  await page.getByTestId("rule-add").click();
  await expect(page.getByTestId("rule-add-group").locator("option")).toHaveText(["Manos"]);
  await page.getByTestId("rule-add-confirm").click();
  await expect(page.getByTestId("rule-retention")).toHaveValue("5");
  await page.getByTestId("rule-paid").fill("35");
  await page.getByTestId("rule-fixed").fill("3000");
  await page.getByTestId("rule-destination").selectOption("SALON");
  await page.getByTestId("rule-editor-next").click();
  await confirmImmediate(page);
  const manosRule = (await proRules(request, s.gaby.id)).groups.find((g) => g.groupId === s.gManos.id)!;
  expect(manosRule).toMatchObject({ ownRule: true, percent: 35, retentionPercent: 5, fixedAmount: 3000, fixedDestination: "SALON" });
  await expect(cards.filter({ hasText: "Manos" }).getByTestId("rule-card-sentence")).toContainText("(for the salon)");

  // Removing a rule leaves her with no rule of her own for that group.
  await cards.filter({ hasText: "Manos" }).getByTestId("rule-card-remove").click();
  await confirmImmediate(page);
  expect((await proRules(request, s.gaby.id)).groups.find((g) => g.groupId === s.gManos.id)!.ownRule).toBe(false);
  await expect(cards).toHaveCount(2);
});

test("AC3 · Equipo: lista ordenada con las reglas de cada persona, búsqueda, filtros y la ficha", async ({ page, request }) => {
  const s = await salon(request);
  await loginAdminUi(page, w);
  await openCommissions(page, "team");
  const cards = page.getByTestId("team-card");
  const names = (await cards.evaluateAll((els) => els.map((e) => e.getAttribute("data-professional") ?? ""))).map((n) => n.toLowerCase());
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  expect(names).toEqual(expect.arrayContaining([w.ana.name.toLowerCase(), "gaby", "jorgelina", "migue"]));
  const card = (name: string) => cards.filter({ hasText: new RegExp(name, "i") });
  await expect(card("gaby").getByTestId("team-card-rules")).toContainText("2 rules · retains 5 %");
  await expect(card("jorgelina").getByTestId("team-card-rules")).toContainText("1 rule");
  await expect(card("migue").getByTestId("team-card-rules")).toContainText("1 rule · retains 5 %");
  await expect(card(w.bea.name).getByTestId("team-card-missing")).toBeVisible();

  // Search ignoring case.
  await page.getByTestId("team-search").fill("JORG");
  await expect(cards).toHaveCount(1);
  await page.getByTestId("team-search").fill("");
  // Filters: only the ones without rules, and only the ones who withhold aguinaldo.
  await page.getByTestId("team-filter-norules").click();
  await expect(card("gaby")).toHaveCount(0);
  await expect(card(w.bea.name)).toHaveCount(1);
  await page.getByTestId("team-filter-retain").click();
  await expect(cards).toHaveCount(2); // Gaby and Migue
  await page.getByTestId("team-filter-all").click();

  // Tapping a professional opens her page; the arrow brings you back.
  await card("jorgelina").click();
  await expect(page.getByTestId("pro-name")).toContainText("Jorgelina", { ignoreCase: true });
  await page.getByTestId("pro-tab-rules").click();
  await expect(page.getByTestId("rule-card")).toHaveCount(1); // her Manos rule
  await page.getByTestId("pro-back").click();
  await expect(page.getByTestId("team-list")).toBeVisible();
  expect(s.gaby.id).toBeGreaterThan(0);
});

test("AC5 · validaciones: pago + retención ≤ 100 %, % entre 0 y 100, monto fijo entero; con error no se guarda", async ({
  page,
  request,
}) => {
  const s = await salon(request);
  await openRulesOf(page, "gaby");
  await page.getByTestId("rule-card").filter({ hasText: "Brushing" }).getByTestId("rule-card-edit").click();
  const paid = page.getByTestId("rule-paid");
  const error = page.getByTestId("rule-editor").getByRole("alert");
  const next = page.getByTestId("rule-editor-next");

  await paid.fill("99");
  await next.click();
  await expect(error).toHaveText("The paid % plus the retention cannot exceed 100 %. Example: 45 and 5.");
  await expect(paid).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByTestId("commission-apply-dialog")).toHaveCount(0);

  await paid.fill("4x");
  await next.click();
  await expect(error).toContainText("between 0 and 100 with up to 2 decimals, for example 45");

  await paid.fill("");
  await next.click();
  await expect(error).toContainText("Enter the paid % to create the rule, for example 45");

  await paid.fill("40");
  await page.getByTestId("rule-fixed").fill("3,5");
  await next.click();
  await expect(error).toHaveText("Enter a whole amount in guaraníes, for example 3,000.");
  await expect(page.getByTestId("commission-apply-dialog")).toHaveCount(0);

  // Nothing was saved, and the server also refuses it (the UI never sends it).
  expect((await proRules(request, s.gaby.id)).groups.find((g) => g.groupId === s.gBrushing.id)!.percent).toBe(45);
  await expect(
    applyChanges(request, w.adminToken, [
      { scope: "GROUP_RULE", groupId: s.gBrushing.id, professionalId: s.gaby.id, value: "60|50|0|" },
    ]),
  ).rejects.toThrow();
});

test("AC6 · ejemplo en vivo: lo que se paga, lo que se retiene y lo que queda en el salón", async ({ page, request }) => {
  await salon(request);
  await openRulesOf(page, "gaby");
  await page.getByTestId("rule-card").filter({ hasText: "Pestañas" }).getByTestId("rule-card-edit").click();
  await page.getByTestId("rule-example-price").fill("50000");
  // 50.000 − 20.000 (product cost, hers) = 30.000 → 45 % = 13.500, 5 % = 1.500; she is paid 13.500 + 20.000.
  await expect(page.getByTestId("example-pays")).toContainText("33.500");
  await expect(page.getByTestId("example-retention")).toContainText("1.500");
  await expect(page.getByTestId("example-salon")).toContainText("15.000");

  // Changing the destination to the salon changes what she is paid.
  await page.getByTestId("rule-destination").selectOption("SALON");
  await expect(page.getByTestId("example-pays")).toContainText("13.500");
  await expect(page.getByTestId("example-salon")).toContainText("35.000");
});

test("AC7 · copiar reglas de otra profesional prepara sus reglas propias y pregunta «desde cuándo»", async ({ page, request }) => {
  const s = await salon(request);
  await openRulesOf(page, "jorgelina");
  await page.getByTestId("rule-copy").click();
  await page.getByTestId("rule-copy-from").selectOption(String(s.gaby.id));
  await page.getByTestId("rule-copy-confirm").click();
  await expect(page.getByRole("dialog")).toContainText("Copy 2 rules");
  await confirmImmediate(page);
  const copied = await proRules(request, s.jorgelina.id);
  expect(copied.groups.find((g) => g.groupId === s.gBrushing.id)).toMatchObject({ percent: 45, retentionPercent: 5, fixedAmount: 0 });
  expect(copied.groups.find((g) => g.groupId === s.gLashes.id)).toMatchObject({ percent: 45, fixedAmount: 20000, fixedDestination: "PROFESSIONAL" });
  // Her own rule for Manos is untouched.
  expect(copied.groups.find((g) => g.groupId === s.gManos.id)).toMatchObject({ percent: 50, retentionPercent: 0, fixedAmount: 3000 });
  await expect(page.getByTestId("rule-card")).toHaveCount(3);

  // A professional with no rules of her own has nothing to copy.
  await page.getByTestId("pro-back").click();
  await openProfessional(page, w.bea.name, "rules");
  await page.getByTestId("rule-copy").click();
  await page.getByTestId("rule-copy-from").selectOption(String(w.ana.id));
  await page.getByTestId("rule-copy-confirm").click();
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveText("That professional has no own rules to copy.");
});

// ── AC8 · AC9 · Configuración ─────────────────────────────────────────────────────────────────

test("AC8 · AC9 · Configuración: retención de aguinaldo, % por defecto, quién retiene y destino del monto fijo", async ({
  page,
  request,
}) => {
  const gaby = await createProfessional(request, w.adminToken, "Gaby");
  await loginAdminUi(page, w);
  await openCommissions(page, "setup");
  const settings = page.getByTestId("commission-settings");

  // Starts off: no retention, the fixed amount is the professional's, the default % row is hidden.
  await expect(settings.getByTestId("commission-setting-AGUINALDO_ENABLED")).toContainText("Off");
  await expect(settings.getByTestId("commission-setting-FIXED_DESTINATION")).toContainText("For the professional");
  await expect(settings.getByTestId("commission-setting-AGUINALDO_DEFAULT")).toHaveCount(0);
  await expect(settings.getByTestId("commission-retention-profiles")).toHaveCount(0);

  // Turn the retention on (asks since when).
  await settings.getByTestId("commission-setting-change-AGUINALDO_ENABLED").click();
  await page.getByTestId("commission-aguinaldo-true").check();
  await page.getByTestId("commission-setting-save").click();
  await confirmImmediate(page);
  await expect(settings.getByTestId("commission-setting-AGUINALDO_ENABLED")).toContainText("On");

  // The default % does not change any calculation: saved straight away.
  await settings.getByTestId("commission-setting-change-AGUINALDO_DEFAULT").click();
  await page.locator("#commission-setting-percent").fill("120");
  await page.getByTestId("commission-setting-save").click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("between 0 and 100 with up to 2 decimals");
  await page.locator("#commission-setting-percent").fill("5");
  await page.getByTestId("commission-setting-save").click();
  await expect(settings.getByTestId("commission-setting-AGUINALDO_DEFAULT")).toContainText("5 %");

  // Who retains: Gaby 5 %, everybody else keeps the whole amount.
  const gabyRow = settings.getByTestId("commission-retention-row").filter({ hasText: "Gaby" });
  await expect(gabyRow.getByTestId("commission-retention-current")).toHaveText("Does not retain (keeps the whole amount)");
  await gabyRow.getByTestId("commission-retention-change").click();
  await page.getByTestId("commission-retention-percent").fill("abc");
  await page.getByTestId("commission-retention-save").click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("between 0 and 100 with up to 2 decimals");
  await page.getByTestId("commission-retention-percent").fill("5");
  await page.getByTestId("commission-retention-save").click();
  await expect(gabyRow.getByTestId("commission-retention-current")).toHaveText("Retains 5 %");

  // The fixed amount can default to the salon.
  await settings.getByTestId("commission-setting-change-FIXED_DESTINATION").click();
  await page.getByTestId("commission-fixed-SALON").check();
  await page.getByTestId("commission-setting-save").click();
  await confirmImmediate(page);
  await expect(settings.getByTestId("commission-setting-FIXED_DESTINATION")).toContainText("For the salon");

  const stored = await apiGetJson<{
    aguinaldoEnabled: boolean;
    aguinaldoDefaultPercent: number;
    fixedDestination: string;
    retentionProfiles: { professionalId: number; percent: number | null }[];
  }>(request, w.adminToken, "/api/commissions/settings");
  expect(stored).toMatchObject({ aguinaldoEnabled: true, aguinaldoDefaultPercent: 5, fixedDestination: "SALON" });
  expect(stored.retentionProfiles.find((r) => r.professionalId === gaby.id)?.percent).toBe(5);

  // That profile prefills the retention of a new rule for her (AC4).
  const g = await createGroup(request, w.adminToken, "Color");
  const color = await createCatalogItem(request, w.adminToken, w, "Color completo");
  await assignToGroup(request, w.adminToken, g.id, [color.id]);
  await openProfessional(page, "gaby", "rules");
  await page.getByTestId("rule-add").click();
  await page.getByTestId("rule-add-confirm").click();
  await page.getByTestId("rule-paid").fill("15");
  await expect(page.getByTestId("rule-retention")).toHaveValue("5");
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

  // The history lists the changes with what changed (Setup › Advanced).
  await page.getByTestId("commissions-nav-setup").click();
  await page.getByTestId("config-advanced-link").click();
  await page.getByTestId("commission-history-toggle").click();
  const history = page.getByTestId("commission-settings-history");
  await expect(history).toContainText("Aguinaldo retention");
  await expect(history).toContainText("Fixed amount destination");
});

test("AC8 · con la retención desactivada no se retiene, no hay columna «Retención» y se avisa", async ({ page, request }) => {
  const token = w.adminToken;
  const gaby = await createProfessional(request, token, "Gaby");
  const brushing = await createCatalogItem(request, token, w, "Brushing pelo largo");
  const g = await createGroup(request, token, "Brushing");
  await assignToGroup(request, token, g.id, [brushing.id]);
  await applyChanges(request, token, [
    { scope: "BASE", value: "TAX_INCLUDED" },
    { scope: "GROUP_RULE", groupId: g.id, professionalId: gaby.id, value: "45|5|0|" },
  ]);
  const inv = await issueInvoice(request, token, [
    { serviceId: brushing.id, name: brushing.name, price: 100000, professionalId: gaby.id },
  ]);
  const [e] = await entriesOfInvoice(request, token, inv.id, 1);
  expect(e.commissionAmount).toBe(45000);
  expect(e.retentionAmount).toBe(0);

  await openRulesOf(page, "gaby");
  // No retention anywhere: no retention in the sentence or the editor, no Aguinaldo tab.
  await expect(page.getByTestId("rule-card-sentence")).toHaveText("Earns 45 %");
  await expect(page.getByTestId("pro-rules-retains")).toHaveCount(0);
  await expect(page.getByTestId("pro-tab-aguinaldo")).toHaveCount(0);
  await page.getByTestId("rule-card-edit").click();
  await expect(page.getByTestId("rule-paid")).toBeVisible();
  await expect(page.getByTestId("rule-retention")).toHaveCount(0);
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

  // Aguinaldo is not offered in Equipo, and its address brings you back to the list (HU-COM-15).
  await page.getByTestId("commissions-nav-team").click();
  await expect(page.getByTestId("team-tab-aguinaldo")).toHaveCount(0);
  await page.goto("/app/commissions/equipo/aguinaldo");
  await expect(page.getByTestId("team-list")).toBeVisible();
  await expect(page).toHaveURL(/\/app\/commissions\/equipo$/);
});

// ── AC9 · AC10 · Cálculo y registro ───────────────────────────────────────────────────────────

test("AC9 · AC10 · cada línea guarda base, % pagado, retención, monto fijo y regla de origen; las anulaciones revierten todo", async ({
  request,
}) => {
  const s = await salon(request);
  const token = w.adminToken;
  const aracelyRows = await createProfessional(request, token, "Aracely");
  const product = await createCatalogItem(request, token, w, "Tinte de venta", { kind: "PRODUCT", price: 80000 });
  const gProduct = await createGroup(request, token, "Venta de producto");
  await assignToGroup(request, token, gProduct.id, [product.id]);
  await applyChanges(request, token, [
    { scope: "GROUP_RULE", groupId: gProduct.id, professionalId: aracelyRows.id, value: "5|5|0|" },
  ]);

  const line = (service: { id: number; name: string }, professionalId: number, price: number) => ({
    serviceId: service.id,
    name: service.name,
    price,
    professionalId,
  });
  const brushingInv = await issueInvoice(request, token, [line(s.brushing, s.gaby.id, 100000)]);
  const lashesInv = await issueInvoice(request, token, [line(s.lashes, s.gaby.id, 50000)]);
  const miguelInv = await issueInvoice(request, token, [line(s.manos, s.migue.id, 50000)]);
  const jorgeInv = await issueInvoice(request, token, [line(s.manos, s.jorgelina.id, 50000)]);
  const productInv = await issueInvoice(request, token, [line(product, aracelyRows.id, 80000)]);

  const only = async (id: number) => (await entriesOfInvoice(request, token, id, 1))[0];
  const brushing = await only(brushingInv.id);
  expect(brushing).toMatchObject({ baseAmount: 100000, commissionAmount: 45000, retentionAmount: 5000, retentionPercent: 5, fixedAmount: 0, ruleOrigin: "BENEFICIARY_GROUP" });
  const lashes = await only(lashesInv.id);
  expect(lashes).toMatchObject({ baseAmount: 30000, commissionAmount: 33500, retentionAmount: 1500, fixedAmount: 20000, fixedToProfessional: true });
  const migue = await only(miguelInv.id);
  expect(migue).toMatchObject({ baseAmount: 47000, commissionAmount: 24150, retentionAmount: 2350, fixedAmount: 3000 });
  const jorge = await only(jorgeInv.id);
  expect(jorge).toMatchObject({ baseAmount: 47000, commissionAmount: 26500, retentionAmount: 0, fixedAmount: 3000 });
  const prod = await only(productInv.id);
  expect(prod).toMatchObject({ itemKind: "PRODUCT", baseAmount: 80000, commissionAmount: 4000, retentionAmount: 4000 });

  // The destination follows the salon default when the rule does not set one.
  await applyChanges(request, token, [{ scope: "FIXED_DESTINATION", value: "SALON" }]);
  await applyChanges(request, token, [
    { scope: "GROUP_RULE", groupId: s.gManos.id, professionalId: s.jorgelina.id, value: "50|0|3000|" },
  ]);
  const saloon = await only((await issueInvoice(request, token, [line(s.manos, s.jorgelina.id, 50000)])).id);
  expect(saloon).toMatchObject({ commissionAmount: 23500, fixedAmount: 3000, fixedToProfessional: false });
  // ...and an explicit destination in the rule wins over that default.
  await applyChanges(request, token, [
    { scope: "GROUP_RULE", groupId: s.gManos.id, professionalId: s.jorgelina.id, value: "50|0|3000|P" },
  ]);
  const explicit = await only((await issueInvoice(request, token, [line(s.manos, s.jorgelina.id, 50000)])).id);
  expect(explicit).toMatchObject({ commissionAmount: 26500, fixedToProfessional: true });

  // Precedence: professional + service > professional + group > service > group > default.
  await applyChanges(request, token, [{ scope: "RULE", serviceId: s.brushing.id, professionalId: s.gaby.id, value: "60" }]);
  const exception = await only((await issueInvoice(request, token, [line(s.brushing, s.gaby.id, 100000)])).id);
  expect(exception).toMatchObject({ ruleOrigin: "BENEFICIARY_ITEM", commissionAmount: 60000, retentionAmount: 0 });
  await applyChanges(request, token, [{ scope: "RULE", serviceId: s.brushing.id, professionalId: s.gaby.id, value: null }]);
  await applyChanges(request, token, [{ scope: "GROUP_RULE", groupId: s.gBrushing.id, value: "30" }]);
  const other = await only((await issueInvoice(request, token, [line(s.brushing, w.ana.id, 100000)])).id);
  expect(other).toMatchObject({ ruleOrigin: "GROUP", commissionAmount: 30000 });

  // Voiding reverses commission, fixed amount and retention together.
  await voidInvoice(request, token, lashesInv.id);
  await expect
    .poll(async () => (await entries(request, token)).filter((e) => e.invoiceId === lashesInv.id).length)
    .toBe(2);
  const both = (await entries(request, token)).filter((e) => e.invoiceId === lashesInv.id);
  expect(both.reduce((a, e) => a + e.commissionAmount, 0)).toBe(0);
  expect(both.reduce((a, e) => a + e.retentionAmount, 0)).toBe(0);
  expect(both.reduce((a, e) => a + e.fixedAmount, 0)).toBe(0);
});

// ── AC11 · Liquidación ────────────────────────────────────────────────────────────────────────

test("AC11 · la liquidación y la vista previa muestran costo de producto y retenido; el total es lo que se paga ahora", async ({
  page,
  request,
}) => {
  const s = await salon(request);
  const token = w.adminToken;
  for (let i = 0; i < 2; i++) {
    const inv = await issueInvoice(request, token, [
      { serviceId: s.manos.id, name: s.manos.name, price: 50000, professionalId: s.migue.id },
    ]);
    await entriesOfInvoice(request, token, inv.id, 1);
  }
  const preview = await apiGetJson<{ total: number; retentionTotal: number }>(
    request,
    token,
    `/api/commissions/settlement-preview?professionalId=${s.migue.id}`,
  );
  expect(preview.total).toBe(48300);
  expect(preview.retentionTotal).toBe(4700);

  await generateSettlements(request, token, [s.migue.id]);
  await loginAdminUi(page, w);
  await openCommissions(page, "settle");
  await liquidarRow(page, "migue").getByTestId("liquidar-row-detail").click();
  const detail = page.getByTestId("commission-settlement-detail");
  await expect(detail.getByTestId("settlement-total")).toContainText("48.300");
  await expect(detail.getByTestId("settlement-product-cost")).toContainText("6.000");
  await expect(detail.getByTestId("settlement-retained")).toContainText("4.700");
  await expect(detail).toContainText("It is not paid with this settlement");
  const lines = detail.getByTestId("settlement-line");
  await expect(lines).toHaveCount(2);
  await expect(lines.first().getByTestId("settlement-line-extra")).toHaveText("Product cost Gs. 3.000 · Retention 5 % · Gs. 2.350");
  await expect(lines.first()).toContainText("Gs. 47.000 × 45 %"); // base after the fixed amount
});

// ── AC12 · AC13 · AC14 · Fondo de aguinaldo ───────────────────────────────────────────────────

test("AC12 · AC13 · AC14 · el fondo entra al aprobar; pagos parcial / por salida / a todas; ajuste manual; anular lo saca", async ({
  page,
  request,
}) => {
  const s = await salon(request);
  const token = w.adminToken;
  const issue = async (service: { id: number; name: string }, professionalId: number, price: number) => {
    const inv = await issueInvoice(request, token, [{ serviceId: service.id, name: service.name, price, professionalId }]);
    await entriesOfInvoice(request, token, inv.id, 1);
  };
  await issue(s.brushing, s.gaby.id, 100000);
  await issue(s.lashes, s.gaby.id, 50000); // retention 5.000 + 1.500
  await issue(s.manos, s.migue.id, 50000); // retention 2.350
  const [gabySettlement, migueSettlement] = (await generateSettlements(request, token, [s.gaby.id, s.migue.id])).sort(
    (a, b) => a.professionalId - b.professionalId,
  );

  // A draft does not feed the fund.
  expect((await aguinaldoSummary(request, token)).totalBalance).toBe(0);
  await loginAdminUi(page, w);
  await page.getByRole("link", { name: "Commissions" }).click();
  await openCommissionsMore(page, "Aguinaldo");
  await expect(page.getByTestId("aguinaldo-empty")).toBeVisible();

  // Approving one settlement from the UI makes its retention enter the fund.
  await page.getByTestId("commissions-nav-settle").click();
  await liquidarRow(page, "gaby").getByTestId("liquidar-row-approve").click();
  await page.getByTestId("liquidar-confirm").click();
  await expect(liquidarRow(page, "gaby")).toContainText("Approved");
  await approveSettlementApi(request, token, migueSettlement.id);
  void gabySettlement;

  await page.goto("/app/commissions");
  await openCommissionsMore(page, "Aguinaldo");
  await expect(page.getByTestId("aguinaldo-total")).toContainText("8.850");
  await expect(page.getByTestId("aguinaldo-count")).toHaveText("2");
  const gabyRow = page.getByTestId("aguinaldo-row").filter({ hasText: "Gaby" });
  const migueRow = page.getByTestId("aguinaldo-row").filter({ hasText: "Migue" });
  await expect(gabyRow.getByTestId("aguinaldo-balance")).toContainText("6.500");
  await expect(migueRow.getByTestId("aguinaldo-balance")).toContainText("2.350");
  await expect(gabyRow).toContainText("No payments yet");

  // Movements: the settlement, with its running balance.
  await gabyRow.getByTestId("aguinaldo-view").click();
  const moves = page.getByTestId("aguinaldo-movement");
  await expect(moves).toHaveCount(1);
  await expect(moves.first()).toContainText("Settlement");
  await expect(moves.first().getByTestId("aguinaldo-movement-amount")).toContainText("6.500");
  await expect(moves.first().getByTestId("aguinaldo-movement-balance")).toContainText("6.500");

  // A partial payment above the balance is refused; a valid one is recorded.
  await gabyRow.getByTestId("aguinaldo-pay").click();
  await page.getByTestId("aguinaldo-mode-PARTIAL").check();
  await page.getByTestId("aguinaldo-amount").fill("500000");
  await page.getByTestId("aguinaldo-pay-confirm").click();
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveText("The amount cannot exceed the balance (Gs. 6.500).");
  await page.getByTestId("aguinaldo-amount").fill("2500");
  await expect(page.getByTestId("aguinaldo-balance-after")).toContainText("4.000");
  await page.getByTestId("aguinaldo-pay-confirm").click();
  await expect(page.getByTestId("aguinaldo-notice")).toHaveText("The aguinaldo payment was recorded.");
  await expect(gabyRow.getByTestId("aguinaldo-balance")).toContainText("4.000");
  await expect(gabyRow).not.toContainText("No payments yet");
  await expect(moves.first()).toContainText("Aguinaldo payment");
  await expect(moves.first().getByTestId("aguinaldo-movement-balance")).toContainText("4.000");

  // Manual adjustment: whole amount and reason required; it cannot leave the balance negative.
  await page.getByTestId("aguinaldo-adjust").click();
  await page.getByTestId("aguinaldo-adjust-amount").fill("0");
  await page.getByTestId("aguinaldo-adjust-confirm").click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("whole amount other than 0, for example -2,350 or 5,000");
  await page.getByTestId("aguinaldo-adjust-amount").fill("-500");
  await page.getByTestId("aguinaldo-adjust-confirm").click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Enter the reason for the adjustment");
  await page.getByTestId("aguinaldo-adjust-reason").fill("factura anulada");
  await page.getByTestId("aguinaldo-adjust-amount").fill("-99999");
  await page.getByTestId("aguinaldo-adjust-confirm").click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("would leave the aguinaldo balance negative");
  await page.getByTestId("aguinaldo-adjust-amount").fill("-500");
  await page.getByTestId("aguinaldo-adjust-confirm").click();
  await expect(page.getByTestId("aguinaldo-notice")).toHaveText("The adjustment was recorded.");
  await expect(gabyRow.getByTestId("aguinaldo-balance")).toContainText("3.500");
  await expect(moves.first()).toContainText("Manual adjustment: factura anulada");

  // Payment on departure: pays the whole balance and closes the fund.
  await migueRow.getByTestId("aguinaldo-pay").click();
  await page.getByTestId("aguinaldo-closes").check();
  await expect(page.getByTestId("aguinaldo-amount")).toHaveCount(0);
  await page.getByTestId("aguinaldo-pay-confirm").click();
  await expect(page.getByTestId("aguinaldo-notice")).toHaveText("The aguinaldo payment was recorded.");
  await expect(migueRow.getByTestId("aguinaldo-balance")).toContainText("0");
  await expect(migueRow.getByTestId("aguinaldo-pay")).toHaveCount(0);

  // «Pay the full balance to everyone»: only the ones with a balance (Gaby).
  await page.getByTestId("aguinaldo-pay-all").click();
  await page.getByTestId("aguinaldo-pay-all-confirm").click();
  await expect(page.getByTestId("aguinaldo-notice")).toHaveText("The payment to 1 professional was recorded.");
  await expect(page.getByTestId("aguinaldo-total")).toContainText("0");
  await expect(page.getByTestId("aguinaldo-pay-all")).toHaveCount(0);
  const after = await aguinaldoSummary(request, token);
  expect(after.balances.find((b) => b.professionalName.toLowerCase() === "gaby")).toMatchObject({ retained: 6500, paid: 6000, balance: 0 });

  // Voiding an approved settlement takes its retention back out of the fund.
  const lola = await createProfessional(request, token, "Lola");
  await applyChanges(request, token, [
    { scope: "GROUP_RULE", groupId: s.gBrushing.id, professionalId: lola.id, value: "45|5|0|" },
  ]);
  await issue(s.brushing, lola.id, 100000);
  const [again] = await generateSettlements(request, token, [lola.id]);
  await approveSettlementApi(request, token, again.id);
  expect((await aguinaldoSummary(request, token)).totalBalance).toBe(5000);
  const voided = await request.post(`${API_BASE}/api/commissions/settlements/${again.id}/void`, {
    headers: authHeaders(token),
    data: { reason: "error de carga" },
  });
  expect(voided.ok(), await voided.text()).toBeTruthy();
  expect((await aguinaldoSummary(request, token)).totalBalance).toBe(0);
});

// ── AC15 · Vista de la profesional ────────────────────────────────────────────────────────────

test("AC15 · «Mis comisiones» muestra lo retenido, el aguinaldo acumulado y el costo de producto incluido", async ({
  page,
  request,
}) => {
  const token = w.adminToken;
  const me = await professionalWithAccess(request, token, "Pro Aguinaldo");
  const manos = await createCatalogItem(request, token, w, "Manos");
  const g = await createGroup(request, token, "Manos");
  await assignToGroup(request, token, g.id, [manos.id]);
  await applyChanges(request, token, [
    { scope: "BASE", value: "TAX_INCLUDED" },
    { scope: "AGUINALDO_ENABLED", value: "true" },
    { scope: "GROUP_RULE", groupId: g.id, professionalId: me.id, value: "45|5|3000|P" },
  ]);
  const inv = await issueInvoice(request, token, [{ serviceId: manos.id, name: manos.name, price: 50000, professionalId: me.id }]);
  await entriesOfInvoice(request, token, inv.id, 1);
  const [settlement] = await generateSettlements(request, token, [me.id]);

  await loginAs(page, me.email, PASSWORD);
  await page.getByRole("link", { name: "My commissions" }).click();
  await expect(page.getByTestId("my-commissions-total")).toContainText("24.150");
  await expect(page.getByTestId("my-commissions-product-cost")).toContainText("3.000");
  await expect(page.getByTestId("my-commissions-retained")).toContainText("2.350");
  // The fund only counts approved settlements.
  await expect(page.getByTestId("my-commissions-aguinaldo-balance")).toContainText("0");
  await expect(page.getByTestId("my-commissions-entries")).toContainText("includes Gs. 3.000 of product");
  await expect(page.getByTestId("my-commissions-entries")).toContainText("Retained Gs. 2.350");

  await approveSettlementApi(request, token, settlement.id);
  await page.reload();
  await expect(page.getByTestId("my-commissions-aguinaldo-balance")).toContainText("2.350");
  await expect(page.getByTestId("my-commissions-aguinaldo")).toContainText("It is paid all together, usually in December.");
  await page.getByTestId("my-commissions-settlements").getByRole("button").first().click();
  await expect(page.getByTestId("my-settlement-detail")).toContainText("Retained Gs. 2.350");
});

// ── AC16 · Auditoría y cambios de reglas ──────────────────────────────────────────────────────

test("AC16 · reglas de grupo programables y con recálculo desde el inicio del periodo; quedan en el historial con grupo y valores", async ({
  page,
  request,
}) => {
  const s = await salon(request);
  const token = w.adminToken;
  const inv = await issueInvoice(request, token, [
    { serviceId: s.brushing.id, name: s.brushing.name, price: 100000, professionalId: s.gaby.id },
  ]);
  const [before] = await entriesOfInvoice(request, token, inv.id, 1);
  expect(before).toMatchObject({ commissionAmount: 45000, retentionAmount: 5000 });

  // Scheduled for the next period: it shows in «Scheduled changes» with group, professional and values.
  await applyChanges(
    request,
    token,
    [{ scope: "GROUP_RULE", groupId: s.gBrushing.id, professionalId: s.gaby.id, value: "40|5|0|" }],
    "NEXT_PERIOD",
  );
  await loginAdminUi(page, w);
  await openCommissions(page, "setup");
  await page.getByTestId("config-advanced-link").click(); // scheduled changes: Setup › Advanced
  await page.getByTestId("commission-scheduled-toggle").click();
  const scheduled = page.getByTestId("commission-scheduled-changes");
  await expect(scheduled).toContainText("Brushing");
  await expect(scheduled).toContainText("Gaby", { ignoreCase: true });
  await expect(scheduled).toContainText("40 % + 5 %");
  await expect(scheduled).toContainText("45 % + 5 %"); // the value in force today
  await scheduled.getByRole("button", { name: "Cancel change" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel change" }).click();
  await expect(page.getByTestId("commission-scheduled-changes")).toHaveCount(0);

  // From the start of the period: the live entry is recalculated (reversal + new revision).
  const res = await applyChanges(
    request,
    token,
    [{ scope: "GROUP_RULE", groupId: s.gBrushing.id, professionalId: s.gaby.id, value: "50|5|0|" }],
    "PERIOD_START",
  );
  expect(res.recalculation).toMatchObject({ entriesRecalculated: 1, deltaAmount: 5000 });
  const all = (await entries(request, token)).filter((e) => e.invoiceId === inv.id);
  expect(all.reduce((a, e) => a + e.commissionAmount, 0)).toBe(50000);
  expect(all.reduce((a, e) => a + e.retentionAmount, 0)).toBe(5000);

  // The history keeps what changed, with the group.
  await page.reload();
  await openCommissions(page, "setup");
  await page.getByTestId("config-advanced-link").click();
  await page.getByTestId("commission-history-toggle").click();
  const history = page.getByTestId("commission-settings-history");
  await expect(history).toContainText(/Group rule · Brushing · gaby/i);
  await expect(history).toContainText("50 % + 5 %");
});
