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
  openCommissionsMore,
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

async function openRules(page: Page, sub: "PROFESSIONAL" | "SERVICE" | "PRODUCT" | "GROUPS" = "PROFESSIONAL") {
  await loginAdminUi(page, w);
  await page.getByRole("link", { name: "Commissions" }).click();
  await page.getByRole("tab", { name: "Rules", exact: true }).click();
  await page.getByTestId(`rules-kind-${sub}`).click();
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
  await openRules(page, "GROUPS");
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
  await page.getByRole("tab", { name: "Rules", exact: true }).click();
  await page.getByTestId("rules-kind-GROUPS").click();
  const withRules = page.getByTestId("group-row").filter({ hasText: "Con reglas" });
  await expect(withRules).toContainText("1 service");
  await withRules.getByRole("button", { name: "Actions for group Con reglas" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "has rules and cannot be deleted" })).toBeVisible();
  await expect(withRules).toBeVisible();
});

test("AC2 · servicios sin grupo: sugerencia por nombre, aceptar una, aceptar todas, elegir a mano y productos juntos", async ({
  page,
  request,
}) => {
  const token = w.adminToken;
  const brushing = await createCatalogItem(request, token, w, "Brushing pelo largo");
  const bano = await createCatalogItem(request, token, w, "Baño de crema");
  const apli = await createCatalogItem(request, token, w, "Aplicación de ampolla");
  const makeup = await createCatalogItem(request, token, w, "Maquillaje");
  const gBrushing = await createGroup(request, token, "Brushing");
  const gTratamiento = await createGroup(request, token, "Tratamiento");
  const gOtros = await createGroup(request, token, "Otros");
  await createCatalogItem(request, token, w, "Shampoo grande", { kind: "PRODUCT" });
  await openRules(page, "GROUPS");

  const ungrouped = page.getByTestId("groups-ungrouped-row");
  const rowOf = (name: string) => ungrouped.filter({ hasText: name });
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
  await expect(rowOf("Brushing pelo largo")).toHaveCount(0);

  // Accept all: only the ones with a suggestion.
  await page.getByTestId("groups-accept-all").click();
  await expect(page.getByTestId("groups-notice")).toHaveText("2 services assigned.");
  await expect(rowOf("Baño de crema")).toHaveCount(0);
  await expect(rowOf("Aplicación de ampolla")).toHaveCount(0);
  await expect(rowOf("Maquillaje")).toBeVisible();
  await expect(page.getByTestId("groups-accept-all")).toHaveCount(0);

  // Pick one by hand.
  await rowOf("Maquillaje").getByTestId("groups-choose").selectOption({ label: "Otros" });
  await expect(page.getByTestId("groups-notice")).toHaveText("1 service assigned.");
  const groups = await apiGetJson<{ id: number; serviceCount: number }[]>(request, token, "/api/commissions/groups");
  expect(groups.find((g) => g.id === gBrushing.id)?.serviceCount).toBe(1);
  expect(groups.find((g) => g.id === gTratamiento.id)?.serviceCount).toBe(2);
  expect(groups.find((g) => g.id === gOtros.id)?.serviceCount).toBe(1);
  void brushing;
  void bano;
  void apli;
  void makeup;

  // Products without a group go together to one group.
  await expect(page.getByTestId("groups-products-assign")).toBeDisabled();
  await page.getByTestId("groups-products-group").selectOption({ label: "Otros" });
  await page.getByTestId("groups-products-assign").click();
  await expect(page.getByTestId("groups-notice")).toContainText("assigned");
  await expect(page.getByTestId("groups-products")).toContainText("Every product has a group.");
});

// ── AC3 · AC4 · AC5 · AC6 · AC7 · Reglas por profesional ──────────────────────────────────────

test("AC3 · AC4 · Reglas abre en «Por profesional»: una fila por grupo con regla, los demás plegados; guardar con «desde cuándo»", async ({
  page,
  request,
}) => {
  const s = await salon(request);
  await loginAdminUi(page, w);
  await page.getByRole("link", { name: "Commissions" }).click();
  await page.getByRole("tab", { name: "Rules", exact: true }).click();
  const panel = page.getByTestId("professional-rules");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("rules-kind-PROFESSIONAL")).toHaveAttribute("aria-pressed", "true");
  for (const k of ["SERVICE", "PRODUCT", "GROUPS"]) await expect(page.getByTestId(`rules-kind-${k}`)).toBeVisible();

  await page.getByTestId(`pro-rules-professional-${s.gaby.id}`).click();
  await expect(page.getByTestId("pro-rules-name")).toHaveText(/^gaby$/i);
  await expect(page.getByTestId("pro-rules-retains")).toHaveText("Retains 5 % for aguinaldo");
  const rows = page.getByTestId("pro-rules-table").getByTestId("pro-rule-row");
  await expect(rows).toHaveCount(2);
  const brushing = rows.filter({ hasText: "Brushing" });
  await expect(brushing.getByTestId("pro-rule-paid")).toHaveValue("45");
  await expect(brushing.getByTestId("pro-rule-retention")).toHaveValue("5");
  await expect(brushing.getByTestId("pro-rule-total")).toHaveText("50 %");
  const lashes = rows.filter({ hasText: "Pestañas" });
  await expect(lashes.getByTestId("pro-rule-fixed")).toHaveValue("20.000");
  await expect(lashes.getByTestId("pro-rule-destination")).toHaveValue("PROFESSIONAL");
  // The other group (Manos) has no rule of hers: folded, with the default-% notice.
  await expect(page.getByTestId("pro-rules-others-toggle")).toContainText("1 more group without its own rule");
  await expect(page.getByTestId("pro-rules-others")).toHaveCount(0);

  // Editing leaves unsaved changes; «Save changes» asks since when.
  await expect(page.getByTestId("rules-pending-bar")).toHaveCount(0);
  await brushing.getByTestId("pro-rule-paid").fill("50");
  await expect(page.getByTestId("rules-pending-count")).toContainText("1 unsaved change");
  await page.getByTestId("rules-save").click();
  await expect(page.getByTestId("commission-apply-dialog")).toBeVisible();
  await confirmImmediate(page);
  await expect(page.getByRole("status").filter({ hasText: "Change applied." })).toBeVisible();
  await expect(page.getByTestId("rules-pending-bar")).toHaveCount(0);
  const saved = (await proRules(request, s.gaby.id)).groups.find((g) => g.groupId === s.gBrushing.id)!;
  expect(saved.percent).toBe(50);
  expect(saved.retentionPercent).toBe(5);

  // New rule on a folded group: the professional's usual retention is prefilled.
  await page.getByTestId("pro-rules-others-toggle").click();
  const manos = page.getByTestId("pro-rules-others").getByTestId("pro-rule-row");
  await expect(manos).toHaveCount(1);
  await manos.getByTestId("pro-rule-paid").fill("35");
  await expect(manos.getByTestId("pro-rule-retention")).toHaveValue("5");
  await manos.getByTestId("pro-rule-fixed").fill("3000");
  await manos.getByTestId("pro-rule-destination").selectOption("SALON");
  await page.getByTestId("rules-save").click();
  await confirmImmediate(page);
  const manosRule = (await proRules(request, s.gaby.id)).groups.find((g) => g.groupId === s.gManos.id)!;
  expect(manosRule).toMatchObject({ ownRule: true, percent: 35, retentionPercent: 5, fixedAmount: 3000, fixedDestination: "SALON" });

  // Removing a rule leaves it with no rule of her own.
  await page.getByRole("button", { name: "Actions for Manos" }).click();
  await page.getByRole("menuitem", { name: "Remove rule" }).click();
  await page.getByTestId("rules-save").click();
  await confirmImmediate(page);
  expect((await proRules(request, s.gaby.id)).groups.find((g) => g.groupId === s.gManos.id)!.ownRule).toBe(false);
});

test("AC5 · validaciones: pago + retención ≤ 100 %, % entre 0 y 100, monto fijo entero; con error no se guarda la fila", async ({
  page,
  request,
}) => {
  const s = await salon(request);
  await openRules(page);
  await page.getByTestId(`pro-rules-professional-${s.gaby.id}`).click();
  const row = page.getByTestId("pro-rules-table").getByTestId("pro-rule-row").filter({ hasText: "Brushing" });
  const paid = row.getByTestId("pro-rule-paid");

  await paid.fill("99");
  await expect(row.getByRole("alert")).toHaveText("The paid % plus the retention cannot exceed 100 %. Example: 45 and 5.");
  await expect(paid).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByTestId("rules-pending-bar")).toHaveCount(0);

  await paid.fill("4x");
  await expect(row.getByRole("alert")).toContainText("between 0 and 100 with up to 2 decimals, for example 45");
  await expect(page.getByTestId("rules-pending-bar")).toHaveCount(0);

  await paid.fill("");
  await expect(row.getByRole("alert")).toContainText("Enter the paid % to create the rule, for example 45");

  await paid.fill("40");
  await expect(row.getByRole("alert")).toHaveCount(0);
  await expect(page.getByTestId("rules-pending-count")).toContainText("1 unsaved change");

  await row.getByTestId("pro-rule-fixed").fill("3,5");
  await expect(row.getByRole("alert")).toHaveText("Enter a whole amount in guaraníes, for example 3,000.");
  await expect(page.getByTestId("rules-pending-bar")).toHaveCount(0);
  await row.getByTestId("pro-rule-fixed").fill("");
  await expect(row.getByRole("alert")).toHaveCount(0);

  // The server also refuses it (the UI never sends it).
  await expect(
    applyChanges(request, w.adminToken, [
      { scope: "GROUP_RULE", groupId: s.gBrushing.id, professionalId: s.gaby.id, value: "60|50|0|" },
    ]),
  ).rejects.toThrow();
});

test("AC6 · ejemplo en vivo: monto fijo, base, lo que se paga, lo que se retiene, lo que cobra y lo que queda en el salón", async ({
  page,
  request,
}) => {
  const s = await salon(request);
  await openRules(page);
  await page.getByTestId(`pro-rules-professional-${s.gaby.id}`).click();
  const lashes = page.getByTestId("pro-rules-table").getByTestId("pro-rule-row").filter({ hasText: "Pestañas" });
  await lashes.getByTestId("pro-rule-group").click();
  await expect(page.getByTestId("pro-rules-example")).toContainText("Live example: Pestañas");
  await page.getByTestId("pro-rules-example-price").fill("50000");
  await expect(page.getByTestId("example-fixed")).toContainText("20.000");
  await expect(page.getByTestId("example-base")).toContainText("30.000");
  await expect(page.getByTestId("example-paid")).toContainText("13.500");
  await expect(page.getByTestId("example-retention")).toContainText("1.500");
  await expect(page.getByTestId("example-pays")).toContainText("33.500");
  await expect(page.getByTestId("example-salon")).toContainText("15.000");
  await expect(page.getByTestId("pro-rules-example")).toContainText("The fixed amount is for the professional");

  // Changing the destination to the salon changes what she is paid.
  await lashes.getByTestId("pro-rule-destination").selectOption("SALON");
  await expect(page.getByTestId("example-pays")).toContainText("13.500");
  await expect(page.getByTestId("pro-rules-example")).toContainText("The fixed amount stays with the salon");
  await expect(page.getByTestId("example-salon")).toContainText("35.000");
});

test("AC7 · copiar reglas de otra profesional deja sus reglas propias como cambios sin guardar", async ({ page, request }) => {
  const s = await salon(request);
  await openRules(page);
  await page.getByTestId(`pro-rules-professional-${s.jorgelina.id}`).click();
  await page.getByTestId("pro-rules-copy").click();
  await page.getByTestId("pro-rules-copy-from").selectOption(String(s.gaby.id));
  await page.getByTestId("pro-rules-copy-confirm").click();
  await expect(page.getByTestId("pro-rules-notice")).toContainText("2 rules copied");
  await expect(page.getByTestId("rules-pending-count")).toContainText("2 unsaved changes");
  // Copied rules are listed with their values, whether or not the group had a rule.
  const rows = page.getByTestId("pro-rules-table").getByTestId("pro-rule-row");
  await expect(rows.filter({ hasText: "Brushing" }).getByTestId("pro-rule-paid")).toHaveValue("45");
  await expect(rows.filter({ hasText: "Pestañas" }).getByTestId("pro-rule-fixed")).toHaveValue("20.000");
  await page.getByTestId("rules-save").click();
  await confirmImmediate(page);
  const copied = await proRules(request, s.jorgelina.id);
  expect(copied.groups.find((g) => g.groupId === s.gBrushing.id)).toMatchObject({ percent: 45, retentionPercent: 5, fixedAmount: 0 });
  expect(copied.groups.find((g) => g.groupId === s.gLashes.id)).toMatchObject({ percent: 45, fixedAmount: 20000, fixedDestination: "PROFESSIONAL" });
  // Her own rule for Manos is untouched.
  expect(copied.groups.find((g) => g.groupId === s.gManos.id)).toMatchObject({ percent: 50, retentionPercent: 0, fixedAmount: 3000 });

  // A professional with no rules of her own has nothing to copy.
  await page.getByTestId(`pro-rules-professional-${w.bea.id}`).click();
  await page.getByTestId("pro-rules-copy").click();
  await page.getByTestId("pro-rules-copy-from").selectOption(String(w.ana.id));
  await page.getByTestId("pro-rules-copy-confirm").click();
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveText("That professional has no own rules to copy.");
});

// ── AC8 · AC9 · Configuración ─────────────────────────────────────────────────────────────────

test("AC8 · AC9 · Configuración: retención de aguinaldo, % por defecto, quién retiene y destino del monto fijo", async ({
  page,
  request,
}) => {
  const gaby = await createProfessional(request, w.adminToken, "Gaby");
  await loginAdminUi(page, w);
  await page.getByRole("link", { name: "Commissions" }).click();
  await openCommissionsMore(page, "Settings");
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
  await page.getByRole("tab", { name: "Rules", exact: true }).click();
  await page.getByTestId(`pro-rules-professional-${gaby.id}`).click();
  await page.getByTestId("pro-rules-others-toggle").click();
  await page.getByTestId("pro-rules-others").getByTestId("pro-rule-paid").fill("15");
  await expect(page.getByTestId("pro-rules-others").getByTestId("pro-rule-retention")).toHaveValue("5");

  // The history lists the changes with what changed.
  await openCommissionsMore(page, "Settings");
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

  await openRules(page);
  await page.getByTestId(`pro-rules-professional-${gaby.id}`).click();
  await expect(page.getByTestId("pro-rules-retention-off")).toContainText("Aguinaldo retention is off");
  await expect(page.getByTestId("pro-rule-retention")).toHaveCount(0);
  await expect(page.getByTestId("pro-rules-retains")).toHaveCount(0);

  await openCommissionsMore(page, "Aguinaldo");
  await expect(page.getByTestId("aguinaldo-off")).toContainText("Aguinaldo retention is off");
  await expect(page.getByTestId("aguinaldo-empty")).toBeVisible();
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
  await page.getByRole("link", { name: "Commissions" }).click();
  await page.getByTestId("commission-settlement-row").first().click();
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
  await page.getByRole("tab", { name: "Settlements", exact: true }).click();
  await page.getByTestId("commission-settlement-row").filter({ hasText: "Gaby" }).click();
  await page.getByTestId("settlement-approve").click();
  await page.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
  await expect(page.getByTestId("settlement-status")).toHaveText("Approved");
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
  await page.getByRole("link", { name: "Commissions" }).click();
  await openCommissionsMore(page, "Settings");
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
  await page.getByRole("link", { name: "Commissions" }).click();
  await openCommissionsMore(page, "Settings");
  await page.getByTestId("commission-history-toggle").click();
  const history = page.getByTestId("commission-settings-history");
  await expect(history).toContainText(/Group rule · Brushing · gaby/i);
  await expect(history).toContainText("50 % + 5 %");
});
