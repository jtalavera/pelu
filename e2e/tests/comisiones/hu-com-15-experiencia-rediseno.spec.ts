import { expect, test } from "@playwright/test";
import { API_BASE, apiGetJson } from "../../fixtures/api";
import {
  applyChanges,
  assignToGroup,
  createGroup,
  enableCommissionsGlobally,
  entriesOfInvoice,
  generateSettlements,
  issueInvoice,
  liquidarRow,
  liquidarStep,
  loginAdminUi,
  loginApi,
  openCommissions,
  openSetupStep,
  openProfessional,
  professionalWithAccess,
  provisionCommissionWorld,
  restoreCommissionsGlobal,
  setTenantFlag,
  type CommissionWorld,
} from "../../fixtures/commissions";

/**
 * HU-COM-15 · Rediseño de la experiencia de Comisiones: Inicio · Liquidar · Equipo · Actividad ·
 * Configurar (requirements/user_stories/HU-COM-15-comisiones-experiencia-rediseno.md).
 * Los criterios que ya cubren otros specs (reglas en frases, editor, Aguinaldo, grupos) se
 * ejercitan en hu-com-14; acá van la estructura, Inicio, Liquidar, Configurar y el resumen.
 */
let w: CommissionWorld;

test.beforeAll(async ({ request }) => {
  await enableCommissionsGlobally(request);
});

test.afterAll(async ({ request }) => {
  await restoreCommissionsGlobal(request);
});

test.beforeEach(async ({ request }) => {
  w = await provisionCommissionWorld(request, "HU-COM-15");
  await applyChanges(request, w.adminToken, [{ scope: "DEFAULT_SERVICE", value: "40" }]);
});

async function accrue(request: Parameters<typeof issueInvoice>[0], professionalId: number | null) {
  const inv = await issueInvoice(request, w.adminToken, [
    { serviceId: w.service.id, name: w.service.name, professionalId },
  ]);
  if (professionalId !== null) await entriesOfInvoice(request, w.adminToken, inv.id, 1);
  return inv;
}

/**
 * Groups every service and gives the group its %, so the first-time guide is out of the way
 * (HU-COM-20). `paidDifferently` are the professionals paid differently in one service (the same 40 %
 * here, only to count as a case); everybody else is paid the usual % of each service.
 */
async function setUpGroupsAndRules(request: Parameters<typeof issueInvoice>[0], paidDifferently: number[] = [w.ana.id]) {
  const g = await createGroup(request, w.adminToken, "Peluquería");
  await assignToGroup(request, w.adminToken, g.id, [w.service.id, w.service2.id]);
  await applyChanges(request, w.adminToken, [
    { scope: "GROUP_RULE", groupId: g.id, value: "40" },
    ...paidDifferently.map((professionalId) => ({ scope: "RULE" as const, serviceId: w.service.id, professionalId, value: "40" })),
  ]);
  return g;
}

type Overview = {
  period: { periodicity: string; from: string; to: string };
  rows: { professionalId: number; status: string; amount: number; settlementId: number | null; ruleCount: number }[];
  unsettled: number;
  drafts: number;
  approved: number;
  paid: number;
  total: number;
  groupCount: number;
  ungroupedServices: number;
  groupsWithoutPercent: number;
  linesWithoutProfessional: number;
  aguinaldoEnabled: boolean;
};
const overview = (request: Parameters<typeof apiGetJson>[0], token: string, offset = 0) =>
  apiGetJson<Overview>(request, token, `/api/commissions/overview?offset=${offset}`);

// ── AC1 · Cinco lugares ───────────────────────────────────────────────────────────────────────

test("AC1 · cinco lugares con el período a la vista y contadores de lo pendiente", async ({ page, request }) => {
  await setUpGroupsAndRules(request);
  await accrue(request, w.ana.id);
  await loginAdminUi(page, w);
  await openCommissions(page);

  for (const [key, label] of [
    ["home", "Home"],
    ["settle", "Settle"],
    ["team", "Team"],
    ["activity", "Activity"],
    ["setup", "Setup"],
  ] as const) {
    await expect(page.getByTestId(`commissions-nav-${key}`)).toContainText(label);
  }
  await expect(page.getByTestId("commissions-period")).toBeVisible();
  // One professional with something unsettled; every group has its % so nothing is pending in Setup (HU-COM-20).
  await expect(page.getByTestId("commissions-nav-badge-settle")).toHaveText("1");
  await expect(page.getByTestId("commissions-nav-badge-setup")).toHaveCount(0);

  for (const [key, path] of [
    ["settle", "/liquidar"],
    ["team", "/equipo"],
    ["activity", "/actividad"],
    ["setup", "/configurar"],
  ] as const) {
    await page.getByTestId(`commissions-nav-${key}`).click();
    await expect(page).toHaveURL(new RegExp(`/app/commissions${path}$`));
  }
  await page.getByTestId("commissions-nav-home").click();
  await expect(page).toHaveURL(/\/app\/commissions$/);
});

// ── AC2 · Inicio ──────────────────────────────────────────────────────────────────────────────

test("AC2 · Inicio: cuánto hay para pagar, avance por estado, «Para revisar» solo con lo que hay y acceso a Liquidar", async ({
  page,
  request,
}) => {
  await setUpGroupsAndRules(request);
  await accrue(request, w.ana.id);
  await accrue(request, w.bea.id);
  await accrue(request, null); // a sale without professional
  await loginAdminUi(page, w);
  await openCommissions(page);

  await expect(page.getByTestId("home-hero")).toBeVisible();
  await expect(page.getByTestId("home-total")).toContainText("80.000");
  await expect(page.getByTestId("home-progress-text")).toContainText("from 2 professionals with commissions");
  // HU-COM-17: the total is split in what is already paid and what is left to pay.
  await expect(page.getByTestId("home-paid-amount")).toContainText("0");
  await expect(page.getByTestId("home-pending-amount")).toContainText("80.000");

  // «Para revisar» lists only what exists: a line without professional (HU-COM-20: no «sin reglas»).
  await expect(page.getByTestId("home-review-lines")).toContainText("1 lines without a professional");
  await expect(page.getByTestId("home-review-noRules")).toHaveCount(0);
  await expect(page.getByTestId("home-review-noPercent")).toHaveCount(0);
  await expect(page.getByTestId("home-review-ungrouped")).toHaveCount(0);
  await expect(page.getByTestId("home-review-drafts")).toHaveCount(0);
  await page.getByTestId("home-review-lines-action").click();
  await expect(page).toHaveURL(/\/app\/commissions\/actividad\?tab=reports$/);
  await expect(page.getByTestId("report-lines-without-beneficiary")).toBeVisible();

  // The steps lead into the settlement (HU-COM-17: «What is left to do»).
  await page.getByTestId("commissions-nav-home").click();
  await expect(page.getByTestId("home-team-row")).toHaveCount(2);
  await page.getByTestId("home-step-UNSETTLED-action").click();
  await expect(page).toHaveURL(/\/app\/commissions\/liquidar\?state=UNSETTLED$/);
});

test("AC2 · Inicio: cuando no hay nada para revisar lo dice", async ({ page, request }) => {
  await setUpGroupsAndRules(request, [w.ana.id, w.bea.id]);
  await accrue(request, w.ana.id);
  await loginAdminUi(page, w);
  await openCommissions(page);
  await expect(page.getByTestId("home-review-empty")).toBeVisible();
  await expect(page.getByTestId("home-review-lines")).toHaveCount(0);
});

// ── AC3 · Guía de primera vez ────────────────────────────────────────────────────────────────

test("AC3 · sin grupos Inicio muestra la guía de tres pasos y se retira al configurarlos", async ({ page, request }) => {
  await loginAdminUi(page, w);
  await openCommissions(page);
  await expect(page.getByTestId("setup-guide")).toBeVisible();
  await expect(page.getByTestId("setup-progress")).toHaveText("1 of 3 steps done");
  for (const n of [1, 2, 3]) await expect(page.getByTestId(`setup-step-${n}`)).toBeVisible();
  await expect(page.getByTestId("setup-step-4")).toHaveCount(0);
  // The step in progress is highlighted and explains what it is for, with an example.
  await expect(page.getByTestId("setup-step-2")).toHaveAttribute("data-state", "current");
  await expect(page.getByTestId("setup-step-2")).toContainText("What is it for?");
  await page.getByTestId("setup-step-2-start").click();
  await expect(page).toHaveURL(/\/configurar\/comisiones$/);
  await expect(page.getByTestId("commission-rates")).toBeVisible();

  await setUpGroupsAndRules(request, [w.ana.id, w.bea.id]);
  await page.getByTestId("commissions-nav-home").click();
  await page.reload();
  await expect(page.getByTestId("setup-guide")).toHaveCount(0);
  await expect(page.getByTestId("home-hero")).toBeVisible();
});

// ── AC4 · AC5 · Liquidar ─────────────────────────────────────────────────────────────────────

test("AC4 · Liquidar: generar → aprobar → pagar en tres pasos, con las filas, los estados y el pago con forma y referencia", async ({
  page,
  request,
}) => {
  await setUpGroupsAndRules(request, [w.ana.id, w.bea.id]);
  await accrue(request, w.ana.id);
  await accrue(request, w.bea.id);
  await loginAdminUi(page, w);
  await openCommissions(page, "settle");

  await expect(page.getByTestId("liquidar-period")).toBeVisible();
  await expect(page.getByTestId("liquidar-step-1-count")).toContainText("2 to generate");
  await expect(page.getByTestId("liquidar-total")).toContainText("80.000");
  await expect(page.getByTestId("liquidar-row")).toHaveCount(2);
  await expect(liquidarRow(page, w.ana.name).getByTestId("liquidar-row-amount")).toContainText("40.000");

  // 1 · Generate everything pending (the confirmation shows the total).
  await page.getByTestId("liquidar-step-1-action").click();
  await expect(page.getByTestId("liquidar-dialog-summary")).toContainText("80.000");
  await page.getByTestId("liquidar-confirm").click();
  await expect(page.getByTestId("liquidar-notice")).toContainText("2 settlements were generated.");
  await expect(page.getByTestId("liquidar-step-2-count")).toContainText("2 to approve");
  for (const row of await page.getByTestId("liquidar-row").all()) await expect(row).toHaveAttribute("data-status", "DRAFT");

  // 2 · Approve.
  await page.getByTestId("liquidar-step-2-action").click();
  await expect(page.getByRole("dialog")).toContainText("the amounts are frozen");
  await page.getByTestId("liquidar-confirm").click();
  await expect(page.getByTestId("liquidar-notice")).toContainText("2 settlements were approved.");
  await expect(page.getByTestId("liquidar-step-3-count")).toContainText("2 to pay");

  // 3 · Pay: method, date and reference.
  await page.getByTestId("liquidar-step-3-action").click();
  await page.getByTestId("liquidar-method").selectOption("TRANSFER");
  await page.getByTestId("liquidar-reference").fill("OP-1500");
  await page.getByTestId("liquidar-confirm").click();
  await expect(page.getByTestId("liquidar-notice")).toContainText("2 settlements were paid.");
  for (const row of await page.getByTestId("liquidar-row").all()) await expect(row).toHaveAttribute("data-status", "PAID");

  const list = await apiGetJson<{ items: { status: string; paymentMethod: string; paymentReference: string }[] }>(
    request,
    w.adminToken,
    "/api/commissions/settlements",
  );
  expect(list.items.map((i) => i.status)).toEqual(["PAID", "PAID"]);
  expect(list.items.every((i) => i.paymentMethod === "TRANSFER" && i.paymentReference === "OP-1500")).toBe(true);
  // A paid row only offers «View» (the detail).
  await expect(liquidarRow(page, w.ana.name).getByTestId("liquidar-row-view")).toBeVisible();
});

test("AC4 · Liquidar: filtros por estado con contador, período anterior y el siguiente apagado en el actual", async ({
  page,
  request,
}) => {
  await setUpGroupsAndRules(request, [w.ana.id, w.bea.id]);
  await accrue(request, w.ana.id);
  await accrue(request, w.bea.id);
  await generateSettlements(request, w.adminToken, [w.ana.id]);
  await loginAdminUi(page, w);
  await openCommissions(page, "settle");

  await expect(page.getByTestId("liquidar-filter-ALL")).toContainText("2");
  await expect(page.getByTestId("liquidar-filter-UNSETTLED")).toContainText("1");
  await expect(page.getByTestId("liquidar-filter-DRAFT")).toContainText("1");
  await page.getByTestId("liquidar-filter-UNSETTLED").click();
  await expect(page.getByTestId("liquidar-row")).toHaveCount(1);
  await expect(page.getByTestId("liquidar-row")).toContainText(w.bea.name, { ignoreCase: true });
  await page.getByTestId("liquidar-filter-ALL").click();

  // The previous period has nothing; the next one is not available from the current period.
  await expect(page.getByTestId("liquidar-next")).toBeDisabled();
  const current = await page.getByTestId("liquidar-period").innerText();
  await page.getByTestId("liquidar-prev").click();
  await expect(page.getByTestId("liquidar-period")).not.toHaveText(current);
  // HU-COM-17: nothing was accrued before, so everybody is listed as «No movements».
  for (const row of await page.getByTestId("liquidar-row").all()) await expect(row).toHaveAttribute("data-status", "NONE");
  await expect(page.getByTestId("liquidar-row")).toHaveCount(2);
  await expect(page.getByTestId("liquidar-next")).toBeEnabled();
  await page.getByTestId("liquidar-next").click();
  await expect(page.getByTestId("liquidar-row")).toHaveCount(2);
});

test("AC5 · generar no repite a quien ya tiene una liquidación del período; el detalle vuelve a Liquidar", async ({
  page,
  request,
}) => {
  await setUpGroupsAndRules(request, [w.ana.id, w.bea.id]);
  await accrue(request, w.ana.id);
  const [first] = await generateSettlements(request, w.adminToken, [w.ana.id]);
  await accrue(request, w.bea.id);
  await loginAdminUi(page, w);
  await openCommissions(page, "settle");
  await liquidarStep(page, 1); // only Bea is pending
  await expect(page.getByTestId("liquidar-notice")).toContainText("1 settlement was generated.");
  const list = await apiGetJson<{ items: { professionalId: number }[]; total: number }>(
    request,
    w.adminToken,
    "/api/commissions/settlements",
  );
  expect(list.total).toBe(2);
  expect(list.items.filter((i) => i.professionalId === w.ana.id)).toHaveLength(1);

  await liquidarRow(page, w.ana.name).getByTestId("liquidar-row-detail").click();
  await expect(page).toHaveURL(new RegExp(`/settlements/${first.id}$`));
  await page.getByTestId("settlement-back").click();
  await expect(page).toHaveURL(/\/app\/commissions\/liquidar$/);
});

// ── AC7 · Historial de la ficha ──────────────────────────────────────────────────────────────

test("AC7 · la ficha tiene Resumen, Reglas e Historial; el Historial es solo de esa profesional", async ({ page, request }) => {
  await setUpGroupsAndRules(request, [w.ana.id, w.bea.id]);
  await accrue(request, w.ana.id);
  await accrue(request, w.bea.id);
  await loginAdminUi(page, w);
  await openCommissions(page);
  await openProfessional(page, w.ana.name);
  await expect(page.getByTestId("pro-tab-summary")).toBeVisible();
  await expect(page.getByTestId("pro-tab-rules")).toBeVisible();
  await expect(page.getByTestId("pro-tab-history")).toBeVisible();
  await expect(page.getByTestId("pro-tab-aguinaldo")).toHaveCount(0); // the salon does not use aguinaldo

  await page.getByTestId("pro-tab-history").click();
  await expect(page.getByTestId("movement-row")).toHaveCount(1);
  await expect(page.getByTestId("movement-row")).toContainText(w.ana.name, { ignoreCase: true });
  await page.getByTestId("movements-filters-toggle").click();
  await expect(page.locator("#mov-professional")).toHaveCount(0); // already filtered by her
});

// ── AC10 · AC11 · Retención usual y Aguinaldo ────────────────────────────────────────────────

test("AC10 · AC11 · con Aguinaldo activo: pestaña en Equipo y en la ficha, y la retención usual se cambia desde la ficha", async ({
  page,
  request,
}) => {
  await setUpGroupsAndRules(request, [w.ana.id, w.bea.id]);
  await applyChanges(request, w.adminToken, [{ scope: "AGUINALDO_ENABLED", value: "true" }]);
  await loginAdminUi(page, w);
  await openCommissions(page, "team");
  await expect(page.getByTestId("team-tab-aguinaldo")).toBeVisible();
  await page.getByTestId("team-tab-aguinaldo").click();
  await expect(page.getByTestId("commission-aguinaldo")).toBeVisible();
  await page.getByTestId("team-tab-people").click();

  await openProfessional(page, w.ana.name, "rules");
  await expect(page.getByTestId("pro-retention-current")).toHaveText("Does not retain for aguinaldo");
  await page.getByTestId("pro-retention-edit").click();
  await page.getByTestId("pro-retention-percent").fill("abc");
  await page.getByTestId("pro-retention-save").click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("between 0 and 100 with up to 2 decimals");
  await page.getByTestId("pro-retention-percent").fill("5");
  await page.getByTestId("pro-retention-save").click();
  // HU-COM-20: her retention comes out of what she is paid, so it asks since when it applies.
  await page.getByTestId("commission-apply-mode-IMMEDIATE").check();
  await page.getByTestId("commission-apply-confirm").click();
  await expect(page.getByTestId("pro-retention-current")).toHaveText("Aguinaldo retention: 5 %");
  const stored = await apiGetJson<{ retentionProfiles: { professionalId: number; percent: number | null }[] }>(
    request,
    w.adminToken,
    "/api/commissions/settings",
  );
  expect(stored.retentionProfiles.find((r) => r.professionalId === w.ana.id)?.percent).toBe(5);

  // Her Aguinaldo tab shows only her fund.
  await page.getByTestId("pro-tab-aguinaldo").click();
  await expect(page.getByTestId("commission-aguinaldo")).toBeVisible();
  await expect(page.getByTestId("aguinaldo-pay-all")).toHaveCount(0);
});

test("AC13 · apagar Aguinaldo en Configurar actualiza la navegación sin recargar", async ({ page, request }) => {
  await setUpGroupsAndRules(request, [w.ana.id, w.bea.id]);
  await applyChanges(request, w.adminToken, [{ scope: "AGUINALDO_ENABLED", value: "true" }]);
  await loginAdminUi(page, w);
  await openCommissions(page, "team");
  await expect(page.getByTestId("team-tab-aguinaldo")).toBeVisible();

  await page.getByTestId("commissions-nav-setup").click();
  await openSetupStep(page, 3);
  await page.getByTestId("commission-setting-change-AGUINALDO_ENABLED").click();
  await page.getByTestId("commission-aguinaldo-false").check();
  await page.getByTestId("commission-setting-save").click();
  await page.getByTestId("commission-apply-mode-IMMEDIATE").check();
  await page.getByTestId("commission-apply-confirm").click();
  await expect(page.getByTestId("commission-setting-AGUINALDO_ENABLED")).toContainText("Off");

  await page.getByTestId("commissions-nav-team").click();
  await expect(page.getByTestId("team-list")).toBeVisible();
  await expect(page.getByTestId("team-tab-aguinaldo")).toHaveCount(0);
});

// ── AC13 · AC14 · Configurar y Avanzado ──────────────────────────────────────────────────────

test("AC13 · Configurar son tres pasos: cómo se calcula, comisión de cada servicio y aguinaldo", async ({ page, request }) => {
  await setUpGroupsAndRules(request, [w.ana.id, w.bea.id]);
  await loginAdminUi(page, w);
  await openCommissions(page, "setup");
  for (const n of [1, 2, 3]) await expect(page.getByTestId(`config-step-${n}`)).toBeVisible();
  await expect(page.getByTestId("config-step-4")).toHaveCount(0); // HU-COM-20: no «rules per professional» step
  await expect(page.getByTestId("config-step-1")).toContainText("How it is calculated");
  await expect(page.getByTestId("config-step-2")).toContainText("Commission of each service");
  await openSetupStep(page, 1);
  await openSetupStep(page, 3);
  for (const scope of ["BASE", "PERIODICITY"]) {
    await expect(page.getByTestId("config-step-1").getByTestId(`commission-setting-${scope}`)).toBeVisible();
  }
  for (const scope of ["AGUINALDO_ENABLED", "FIXED_DESTINATION"]) {
    await expect(page.getByTestId("config-step-3").getByTestId(`commission-setting-${scope}`)).toBeVisible();
  }
  await openSetupStep(page, 2);
  await page.getByTestId("config-step-2-order-link").click();
  await expect(page.getByTestId("commission-groups")).toBeVisible();
  await page.getByTestId("config-back").click();
  await openSetupStep(page, 2);
  await page.getByTestId("config-step-2-link").click();
  await expect(page).toHaveURL(/\/app\/commissions\/configurar\/comisiones$/);
  await expect(page.getByTestId("commission-rates")).toBeVisible();
});

test("AC14 · Excepciones por servicio y «Cambios programados e historial» salen de Configurar", async ({ page }) => {
  await loginAdminUi(page, w);
  await openCommissions(page, "setup");
  // The exceptions are a visible tab of «Groups and services» (HU-COM-16), with the order in which rules apply.
  await page.getByTestId("config-exceptions-link").click();
  const rules = page.getByTestId("advanced-precedence").getByRole("listitem");
  // HU-COM-20: four layers from the general to the specific; the last one that applies wins.
  await expect(rules).toHaveCount(4);
  await expect(rules.first()).toHaveText("Default %");
  await expect(rules.last()).toHaveText("% of the professional for that service");
  await expect(page.getByTestId("advanced-precedence")).toContainText("the last one that applies wins");
  await expect(page.getByTestId("rules-kind-SERVICE")).toBeVisible();
  await expect(page.getByTestId("rules-kind-PRODUCT")).toBeVisible();
  await page.getByTestId("config-back").click();
  // Scheduled changes and the change history have their own page.
  await page.getByTestId("config-advanced-link").click();
  await expect(page.getByTestId("commissions-advanced")).toBeVisible();
  await expect(page.getByTestId("commission-scheduled-toggle")).toBeVisible();
  await expect(page.getByTestId("commission-history-toggle")).toBeVisible();
  await page.getByTestId("config-back").click();
  await expect(page.getByTestId("config-step-1")).toBeVisible();
});

// ── AC16 · Módulo apagado y móvil ────────────────────────────────────────────────────────────

test("AC16 · con el módulo apagado se explica qué es y cómo pedirlo", async ({ page, request }) => {
  await setTenantFlag(request, w.tenantId, "COMMISSIONS", false);
  try {
    await loginAdminUi(page, w);
    await page.goto("/app/commissions");
    await expect(page.getByTestId("commissions-disabled")).toBeVisible();
    await expect(page.getByTestId("commissions-nav-home")).toHaveCount(0);
  } finally {
    await setTenantFlag(request, w.tenantId, "COMMISSIONS", true);
  }
});

test("AC16 · en el celular no hay scroll horizontal y los lugares tienen alto táctil", async ({ page, request }) => {
  await setUpGroupsAndRules(request, [w.ana.id, w.bea.id]);
  await accrue(request, w.ana.id);
  await accrue(request, w.bea.id);
  await page.setViewportSize({ width: 390, height: 800 });
  await loginAdminUi(page, w);
  await page.goto("/app/commissions"); // on a phone the app menu is the bottom bar: go by address
  await expect(page.getByTestId("commissions")).toBeVisible();
  for (const section of ["home", "settle", "team", "activity", "setup"] as const) {
    await page.getByTestId(`commissions-nav-${section}`).click();
    await expect(page.getByTestId(`commissions-nav-${section}`)).toBeVisible();
    expect((await page.getByTestId(`commissions-nav-${section}`).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `scroll horizontal en ${section}`).toBeLessThanOrEqual(1);
  }
});

// ── AC17 · API del resumen del período ───────────────────────────────────────────────────────

test("AC17 · GET /overview: una fila por profesional activa con su estado, totales y alertas; período anterior con offset", async ({
  request,
}) => {
  await setUpGroupsAndRules(request); // Ana has rules, Bea not
  await accrue(request, w.ana.id);
  await accrue(request, w.bea.id);
  await accrue(request, null);

  let o = await overview(request, w.adminToken);
  expect(o.rows.find((r) => r.professionalId === w.ana.id)).toMatchObject({ status: "UNSETTLED", amount: 40000, ruleCount: 1 });
  expect(o.rows.find((r) => r.professionalId === w.bea.id)).toMatchObject({ status: "UNSETTLED", ruleCount: 0 });
  expect(o).toMatchObject({
    unsettled: 2,
    drafts: 0,
    approved: 0,
    paid: 0,
    groupCount: 1,
    ungroupedServices: 0,
    groupsWithoutPercent: 0,
    linesWithoutProfessional: 1,
    aguinaldoEnabled: false,
  });

  const [s] = await generateSettlements(request, w.adminToken, [w.ana.id]);
  o = await overview(request, w.adminToken);
  expect(o.rows.find((r) => r.professionalId === w.ana.id)).toMatchObject({ status: "DRAFT", settlementId: s.id });
  expect(o).toMatchObject({ unsettled: 1, drafts: 1 });

  // The previous period is empty (everything accrued today) and starts before the current one.
  const prev = await overview(request, w.adminToken, -1);
  expect(prev.period.to < o.period.from).toBe(true);
  expect(prev.rows.every((r) => r.status === "NONE")).toBe(true);
});

test("AC17 · GET /overview: solo ADMIN; una profesional recibe 403 y sin sesión se rechaza", async ({ request }) => {
  const pro = await professionalWithAccess(request, w.adminToken, "Pro Acceso");
  const proToken = await loginApi(request, pro.email);
  const asPro = await request.get(`${API_BASE}/api/commissions/overview`, { headers: { Authorization: `Bearer ${proToken}` } });
  expect(asPro.status()).toBe(403);
  const anonymous = await request.get(`${API_BASE}/api/commissions/overview`);
  expect([401, 403]).toContain(anonymous.status());
});
