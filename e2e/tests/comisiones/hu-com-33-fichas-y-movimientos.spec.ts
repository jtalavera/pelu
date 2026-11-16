import { expect, test, type Page } from "@playwright/test";
import { apiPostJson } from "../../fixtures/api";
import {
  applyChanges,
  approveSettlementApi,
  assignToGroup,
  createGroup,
  enableCommissionsGlobally,
  entriesOfInvoice,
  generateSettlements,
  issueInvoice,
  loginAdminUi,
  openCommissions,
  openProfessional,
  provisionCommissionWorld,
  restoreCommissionsGlobal,
  todayYmd,
  type CommissionWorld,
} from "../../fixtures/commissions";

/**
 * HU-COM-33 · Fichas y Movimientos: Movimientos en filas parejas, tarjeta «A pagar» con etapas, Reglas en tres cuadros y
 * Equipo sin iniciales (requirements/user_stories/HU-COM-33-fichas-y-movimientos.md).
 */
let w: CommissionWorld;

test.beforeAll(async ({ request }) => {
  await enableCommissionsGlobally(request);
});

test.afterAll(async ({ request }) => {
  await restoreCommissionsGlobal(request);
});

test.beforeEach(async ({ request }) => {
  w = await provisionCommissionWorld(request, "HU-COM-33");
  await applyChanges(request, w.adminToken, [{ scope: "BASE", value: "TAX_INCLUDED" }]);
});

type Req = Parameters<typeof issueInvoice>[0];

/** A service at 40 % and a product at 10 % (Ana): 40.000 + 10.000. */
async function plainSales(request: Req) {
  await applyChanges(request, w.adminToken, [
    { scope: "RULE", serviceId: w.service.id, value: "40" },
    { scope: "DEFAULT_PRODUCT", value: "10" },
  ]);
  const inv = await issueInvoice(request, w.adminToken, [
    { serviceId: w.service.id, name: w.service.name, price: 100000, professionalId: w.ana.id },
    { serviceId: w.product.id, name: w.product.name, price: 100000, professionalId: w.ana.id },
  ]);
  await entriesOfInvoice(request, w.adminToken, inv.id, 2);
}

/** Group at 50 %; Ana retains 5 %: a sale recalculated to 40 % when her retention goes to 10 %, and a plain one of Bea. */
async function recalculatedSale(request: Req) {
  const g = await createGroup(request, w.adminToken, "Peluquería");
  await assignToGroup(request, w.adminToken, g.id, [w.service.id]);
  await applyChanges(request, w.adminToken, [
    { scope: "AGUINALDO_ENABLED", value: "true" },
    { scope: "RETENTION_PROFILE", professionalId: w.ana.id, value: "5" },
    { scope: "GROUP_RULE", groupId: g.id, value: "50" },
  ]);
  for (const professionalId of [w.ana.id, w.bea.id]) {
    const inv = await issueInvoice(request, w.adminToken, [{ serviceId: w.service.id, name: w.service.name, price: 100000, professionalId }]);
    await entriesOfInvoice(request, w.adminToken, inv.id, 1);
  }
  await applyChanges(request, w.adminToken, [{ scope: "RETENTION_PROFILE", professionalId: w.ana.id, value: "10" }], "PERIOD_START");
}

/** Group at 50 %; Ana's own rule of 40 % from the start of the period recalculates her sale (before 50 %); Bea's stays plain. */
async function recalculatedNoRetention(request: Req) {
  const g = await createGroup(request, w.adminToken, "Peluquería");
  await assignToGroup(request, w.adminToken, g.id, [w.service.id]);
  await applyChanges(request, w.adminToken, [{ scope: "GROUP_RULE", groupId: g.id, value: "50" }]);
  for (const professionalId of [w.ana.id, w.bea.id]) {
    const inv = await issueInvoice(request, w.adminToken, [{ serviceId: w.service.id, name: w.service.name, price: 100000, professionalId }]);
    await entriesOfInvoice(request, w.adminToken, inv.id, 1);
  }
  await applyChanges(request, w.adminToken, [{ scope: "RULE", serviceId: w.service.id, professionalId: w.ana.id, value: "40" }], "PERIOD_START");
}

const rows = (page: Page) => page.getByTestId("movement-row");
const height = async (loc: ReturnType<Page["locator"]>) => Math.round((await loc.boundingBox())?.height ?? 0);

async function openAnaMovements(page: Page) {
  await loginAdminUi(page, w);
  await openCommissions(page);
  await openProfessional(page, w.ana.name, "history");
  await expect(page.getByTestId("commission-movements")).toBeVisible();
}

// ── AC1 · AC2 · AC3 · Movimientos ─────────────────────────────────────────────────────────────────

test("AC1 · AC2 · todas las filas miden lo mismo; la flecha de la izquierda abre «Cómo llegó a este monto» y la etiqueta va en Tipo", async ({
  page,
  request,
}) => {
  await recalculatedNoRetention(request);
  await loginAdminUi(page, w);
  await openCommissions(page, "activity");
  await page.getByTestId("activity-tab-movements").click();
  await expect(rows(page)).toHaveCount(2);

  // Same height with and without a history (the toggle is no longer a row of its own).
  const changed = rows(page).filter({ hasText: "Recalculated" });
  const plain = rows(page).filter({ hasNotText: "Recalculated" });
  await expect(changed).toHaveCount(1);
  expect(await height(changed)).toBe(await height(plain));

  // The tag sits in the TYPE column and «before 45 %» in the CALCULATION one.
  await expect(changed.getByTestId("movement-type").getByTestId("movement-tag")).toHaveText("Recalculated");
  await expect(changed.getByTestId("movement-calc-note")).toHaveText("before 50 %");
  // The arrow is the first cell of the row, to the left of the date.
  const toggle = changed.getByTestId("movement-changes-toggle");
  const arrowBox = (await toggle.boundingBox())!;
  const dateBox = (await changed.getByTestId("movement-date").boundingBox())!;
  expect(arrowBox.x + arrowBox.width).toBeLessThanOrEqual(dateBox.x + 1);
  await expect(toggle).toHaveAttribute("aria-label", "See changes · 3 rows");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(changed.getByTestId("movement-step")).toHaveCount(3);
  await expect(changed.getByTestId("movement-changes-net")).toContainText("Net of this sale");
});

test("AC3 · en la ficha de Ana no hay columna Profesional; en Movimientos general sí", async ({ page, request }) => {
  await recalculatedSale(request);
  await openAnaMovements(page);
  const head = page.getByTestId("movements-head");
  await expect(head).not.toContainText("Professional");
  await expect(head).toContainText("Item");
  await expect(rows(page).first().getByTestId("movement-professional")).toHaveCount(0);

  await page.goto("/app/commissions/actividad");
  await page.getByTestId("activity-tab-movements").click();
  await expect(page.getByTestId("movements-head")).toContainText("Professional");
  await expect(rows(page).first().getByTestId("movement-professional")).toBeVisible();
});

// ── AC4 · AC5 · AC6 · la tarjeta «A pagar este período» ───────────────────────────────────────────

const currentStep = (page: Page) => page.locator('[data-testid="pro-step"][data-state="current"]');

test("AC4 · la tarjeta muestra las etapas: Por generar → Borrador → Aprobada → Pagada, con el siguiente paso", async ({ page, request }) => {
  await plainSales(request);
  await loginAdminUi(page, w);
  await openCommissions(page);
  await openProfessional(page, w.ana.name, "summary");
  await expect(page.getByTestId("pro-step")).toHaveCount(4);
  await expect(currentStep(page)).toHaveText(/To generate/);
  await expect(page.getByTestId("pro-summary-lines")).toContainText("the settlement has not been generated yet");
  await expect(page.getByTestId("pro-summary-go-settle")).toBeVisible();

  const [draft] = await generateSettlements(request, w.adminToken, [w.ana.id]);
  await page.reload();
  await expect(currentStep(page)).toHaveText(/Draft/);
  await expect(page.locator('[data-testid="pro-step"][data-state="done"]')).toHaveCount(1);
  await expect(page.getByTestId("pro-summary-lines")).toContainText("next: approve it");
  await expect(page.getByTestId("pro-summary-open-settlement")).toHaveText(/Open the settlement/i);

  await approveSettlementApi(request, w.adminToken, draft.id);
  await page.reload();
  await expect(currentStep(page)).toHaveText(/Approved/);
  await expect(page.getByTestId("pro-summary-lines")).toContainText("next: mark it as paid");

  await apiPostJson(request, w.adminToken, `/api/commissions/settlements/${draft.id}/pay`, {
    paymentMethod: "TRANSFER",
    paidOn: todayYmd(),
    paymentReference: "OP-778",
  });
  await page.reload();
  await expect(currentStep(page)).toHaveText(/Paid/);
  await expect(page.locator('[data-testid="pro-step"][data-state="done"]')).toHaveCount(3);
  await expect(page.getByTestId("pro-summary-paid-info")).toContainText("OP-778");
  await expect(page.getByTestId("pro-summary-open-settlement")).toHaveText(/View the settlement/i);
});

test("AC5 · con una liquidación generada el desglose sale de ella y suma el total (ya no dice 0), con los ajustes", async ({ page, request }) => {
  await plainSales(request);
  const [draft] = await generateSettlements(request, w.adminToken, [w.ana.id]);
  await apiPostJson(request, w.adminToken, `/api/commissions/settlements/${draft.id}/adjustments`, { amount: 5000, reason: "Bono por desempeño" });
  await loginAdminUi(page, w);
  await openCommissions(page);
  await openProfessional(page, w.ana.name, "summary");

  await expect(page.getByTestId("pro-summary-total")).toContainText("55.000");
  await expect(page.getByTestId("pro-summary-services")).toContainText("40.000");
  await expect(page.getByTestId("pro-summary-products")).toContainText("10.000");
  await expect(page.getByTestId("pro-summary-adjustments")).toContainText("+Gs. 5.000");
  await expect(page.getByTestId("pro-summary-lines")).toContainText("2 invoiced lines");
});

test("AC6 · sin liquidación el desglose sale de lo pendiente, como antes", async ({ page, request }) => {
  await plainSales(request);
  await loginAdminUi(page, w);
  await openCommissions(page);
  await openProfessional(page, w.ana.name, "summary");
  await expect(page.getByTestId("pro-summary-total")).toContainText("50.000");
  await expect(page.getByTestId("pro-summary-services")).toContainText("40.000");
  await expect(page.getByTestId("pro-summary-products")).toContainText("10.000");
  await expect(page.getByTestId("pro-summary-adjustments")).toHaveCount(0);
});

// ── AC7 · AC8 · Reglas ────────────────────────────────────────────────────────────────────────────

test("AC7 · Reglas: ya no está la caja celeste; hay tres cuadros (Comisión, Retención, Excepciones) y la lista", async ({ page, request }) => {
  await applyChanges(request, w.adminToken, [
    { scope: "AGUINALDO_ENABLED", value: "true" },
    { scope: "RETENTION_PROFILE", professionalId: w.ana.id, value: "5" },
    { scope: "RULE", serviceId: w.service.id, professionalId: w.ana.id, value: "50" },
  ]);
  await loginAdminUi(page, w);
  await openCommissions(page);
  await openProfessional(page, w.ana.name, "rules");

  const summary = page.getByTestId("pro-rates-summary");
  await expect(summary.getByTestId("pro-rates-usual")).toContainText("The usual");
  await expect(summary.getByTestId("pro-rates-link")).toHaveAttribute("href", /configurar\/comisiones/);
  await expect(summary.getByTestId("pro-retention-current")).toHaveText("5 %");
  await expect(summary.getByTestId("pro-differences-count")).toHaveText("1");
  // The old notice (a name repeated and a long explanation) is gone.
  await expect(page.getByTestId("pro-rates")).not.toContainText("Here you only note where");
  await expect(page.getByTestId("pro-differences")).toBeVisible();
  await expect(page.getByTestId("pro-rate-row")).toHaveCount(1);
  await expect(page.getByTestId("pro-rates-add")).toBeVisible();
});

test("AC8 · Reglas sin excepciones: el cuadro dice «None» y la lista explica que cobra lo normal; sin retención no hay cuadro de retención", async ({
  page,
}) => {
  await loginAdminUi(page, w);
  await openCommissions(page);
  await openProfessional(page, w.bea.name, "rules");
  await expect(page.getByTestId("pro-differences-count")).toHaveText("None");
  await expect(page.getByTestId("pro-differences-empty")).toBeVisible();
  await expect(page.getByTestId("pro-retention")).toHaveCount(0);
});

// ── AC9 · Equipo ──────────────────────────────────────────────────────────────────────────────────

test("AC9 · Equipo: la tarjeta empieza por el nombre (sin iniciales) y solo dice algo extra si lo hay", async ({ page, request }) => {
  await applyChanges(request, w.adminToken, [
    { scope: "AGUINALDO_ENABLED", value: "true" },
    { scope: "RETENTION_PROFILE", professionalId: w.ana.id, value: "5" },
    { scope: "RULE", serviceId: w.service.id, professionalId: w.bea.id, value: "50" },
  ]);
  await plainSales(request);
  await loginAdminUi(page, w);
  await openCommissions(page, "team");
  const ana = page.getByTestId("team-card").filter({ hasText: w.ana.name });
  const bea = page.getByTestId("team-card").filter({ hasText: w.bea.name });
  // Nothing before the name: the card's text starts with it.
  expect(((await ana.innerText()).split("\n")[0] ?? "").trim().toUpperCase()).toBe(w.ana.name.toUpperCase());
  await expect(ana.getByTestId("team-card-amount")).toContainText("Gs.");
  await expect(ana.getByTestId("team-card-detail")).toContainText("to generate");
  // «Retains 5 %» is the only extra line of Ana; Bea has her own rule; neither repeats «the usual».
  await expect(ana.getByTestId("team-card-rules")).toHaveText(/retains 5 %/i);
  await expect(bea.getByTestId("team-card-rules")).toContainText("different");
  await expect(page.getByTestId("team-list")).not.toContainText("Paid the usual % of each service");
  // Touching the card still opens the file.
  await ana.click();
  await expect(page.getByTestId("commission-professional")).toBeVisible();
});

test("AC9 · tampoco hay iniciales en Liquidar, Inicio ni en el encabezado de la ficha", async ({ page, request }) => {
  await plainSales(request);
  await loginAdminUi(page, w);
  const initials = w.ana.name.slice(0, 2).toUpperCase();
  const lines = async (loc: ReturnType<Page["locator"]>) => (await loc.innerText()).split("\n").map((l) => l.trim()).filter(Boolean);

  await openCommissions(page, "settle");
  const row = page.getByTestId("liquidar-row").filter({ hasText: w.ana.name });
  expect(await lines(row)).not.toContain(initials);

  await openCommissions(page, "home");
  const home = page.getByTestId("home-team-row").filter({ hasText: w.ana.name });
  expect((await lines(home))[0].toUpperCase()).toBe(w.ana.name.toUpperCase());

  await openCommissions(page);
  await openProfessional(page, w.ana.name, "summary");
  expect((await lines(page.locator("header").filter({ has: page.getByTestId("pro-name") })))[0].toUpperCase()).toBe(w.ana.name.toUpperCase());
});
