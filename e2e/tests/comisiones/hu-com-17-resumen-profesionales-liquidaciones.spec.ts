import { expect, test } from "@playwright/test";
import { apiGetJson } from "../../fixtures/api";
import {
  applyChanges,
  approveSettlementApi,
  assignToGroup,
  createGroup,
  createProfessional,
  enableCommissionsGlobally,
  entriesOfInvoice,
  generateSettlements,
  issueInvoice,
  liquidarRow,
  liquidarTab,
  loginAdminUi,
  openCommissions,
  provisionCommissionWorld,
  restoreCommissionsGlobal,
  type CommissionWorld,
} from "../../fixtures/commissions";
import { apiPostJson } from "../../fixtures/api";
import { todayYmd } from "../../fixtures/commissions";

/**
 * HU-COM-17 · Resumen claro de profesionales y liquidaciones
 * (requirements/user_stories/HU-COM-17-resumen-profesionales-liquidaciones.md).
 */
let w: CommissionWorld;

test.beforeAll(async ({ request }) => {
  await enableCommissionsGlobally(request);
});

test.afterAll(async ({ request }) => {
  await restoreCommissionsGlobal(request);
});

test.beforeEach(async ({ request }) => {
  w = await provisionCommissionWorld(request, "HU-COM-17");
  await applyChanges(request, w.adminToken, [{ scope: "DEFAULT_SERVICE", value: "40" }]);
  // A group with its % so the home is not the first-time guide (HU-COM-20).
  const g = await createGroup(request, w.adminToken, "Peluquería");
  await assignToGroup(request, w.adminToken, g.id, [w.service.id, w.service2.id]);
  await applyChanges(request, w.adminToken, [{ scope: "GROUP_RULE", groupId: g.id, value: "40" }]);
});

async function accrue(request: Parameters<typeof issueInvoice>[0], professionalId: number) {
  const inv = await issueInvoice(request, w.adminToken, [{ serviceId: w.service.id, name: w.service.name, professionalId }]);
  await entriesOfInvoice(request, w.adminToken, inv.id, 1);
}

async function pay(request: Parameters<typeof issueInvoice>[0], settlementId: number) {
  await approveSettlementApi(request, w.adminToken, settlementId);
  await apiPostJson(request, w.adminToken, `/api/commissions/settlements/${settlementId}/pay`, {
    paymentMethod: "CASH",
    paidOn: todayYmd(),
    paymentReference: "",
  });
}

/** Ana paid (40.000), Bea in draft (40.000), Carla unsettled (40.000) and two without sales. */
async function team(request: Parameters<typeof issueInvoice>[0]) {
  const carla = await createProfessional(request, w.adminToken, "Carla");
  await createProfessional(request, w.adminToken, "Rosa");
  await createProfessional(request, w.adminToken, "Tomás");
  await accrue(request, w.ana.id);
  await accrue(request, w.bea.id);
  await accrue(request, carla.id);
  const [anaS] = await generateSettlements(request, w.adminToken, [w.ana.id]);
  await pay(request, anaS.id);
  await generateSettlements(request, w.adminToken, [w.bea.id]);
  return { carla, anaS };
}

type Overview = { rows: { professionalName: string; status: string; amount: number; lineCount: number; paidOn: string | null }[] };

// ── AC1 · Todas las profesionales activas ─────────────────────────────────────────────────────

test("AC1 · Liquidar cuenta a TODAS las profesionales activas: las con movimientos en sus pestañas; las sin movimientos, en una línea al pie", async ({
  page,
  request,
}) => {
  await team(request);
  await loginAdminUi(page, w);
  await openCommissions(page, "settle");

  // 5 active professionals: 3 with commissions (one per stage) and 2 without sales this period.
  await expect(page.getByTestId("liquidar-scope")).toHaveCount(0); // HU-COM-28: no «5 active professionals are shown» banner
  await expect(page.getByTestId("liquidar-tab-UNSETTLED-count")).toHaveText("1");
  await expect(page.getByTestId("liquidar-tab-DRAFT-count")).toHaveText("1");
  await expect(page.getByTestId("liquidar-tab-APPROVED-count")).toHaveText("0");
  await expect(page.getByTestId("liquidar-tab-PAID-count")).toHaveText("1");
  // It opens on the stage that is next to do, and only its rows are shown.
  await expect(page.getByTestId("liquidar-tab-UNSETTLED")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("liquidar-row")).toHaveCount(1);
  await expect(page.getByTestId("liquidar-row")).toHaveAttribute("data-status", "UNSETTLED");
  await liquidarTab(page, "DRAFT");
  await expect(page.getByTestId("liquidar-row")).toHaveAttribute("data-status", "DRAFT");
  await liquidarTab(page, "PAID");
  await expect(page.getByTestId("liquidar-row")).toHaveAttribute("data-status", "PAID");

  // The two without movements are not rows: a line at the bottom opens their names.
  await expect(page.getByTestId("liquidar-none-toggle")).toContainText("2 with no movements");
  await expect(page.getByTestId("liquidar-none-list")).toHaveCount(0);
  await page.getByTestId("liquidar-none-toggle").click();
  await expect(page.getByTestId("liquidar-none-item")).toHaveCount(2);
  await expect(page.getByTestId("liquidar-none-list")).toContainText("Rosa", { ignoreCase: true });
  await expect(page.getByTestId("liquidar-none-list")).toContainText("Tomás", { ignoreCase: true });
  // HU-COM-20: a professional with nothing loaded is paid the usual %, so there is no «no rules» note.
  await expect(page.getByTestId("liquidar-none-list")).not.toContainText("no rules");
  await expect(page.getByTestId("liquidar-row").filter({ hasText: "Rosa" })).toHaveCount(0);
});

// ── AC2 · Cada fila dice qué hay detrás de su monto ───────────────────────────────────────────

test("AC2 · cada fila dice qué hay detrás: movimientos, liquidación o cuándo se pagó; cada pestaña dice cuánto suma", async ({ page, request }) => {
  const t = await team(request);
  await loginAdminUi(page, w);
  await openCommissions(page, "settle");

  await expect(liquidarRow(page, "Carla").getByTestId("liquidar-row-note")).toHaveText("1 movement");
  await expect(page.getByTestId("liquidar-summary")).toContainText("1 professional");
  await expect(page.getByTestId("liquidar-summary")).toContainText("40.000");
  await liquidarTab(page, "DRAFT");
  await expect(liquidarRow(page, w.bea.name).getByTestId("liquidar-row-note")).toContainText("Settlement #");
  await expect(page.getByTestId("liquidar-summary")).toContainText("40.000");
  await liquidarTab(page, "PAID");
  await expect(liquidarRow(page, w.ana.name).getByTestId("liquidar-row-note")).toContainText("Paid on");
  await expect(page.getByTestId("liquidar-summary")).toContainText("40.000");
  await liquidarTab(page, "APPROVED");
  await expect(page.getByTestId("liquidar-summary")).toContainText("0 professionals");
  await expect(page.getByTestId("liquidar-empty")).toBeVisible();
  // The total says how much is already paid.
  await expect(page.getByTestId("liquidar-total")).toContainText("120.000");
  await expect(page.getByTestId("liquidar-paid-total")).toContainText("40.000");
  expect(t.anaS.id).toBeGreaterThan(0);
});

// ── AC3 · AC4 · AC5 · Inicio ──────────────────────────────────────────────────────────────────

test("AC3 · AC4 · Inicio separa «Ya pagado» de «Falta pagar», explica la barra y muestra los 4 pasos con personas y plata", async ({
  page,
  request,
}) => {
  await team(request);
  await loginAdminUi(page, w);
  await openCommissions(page);

  await expect(page.getByTestId("home-total")).toContainText("120.000");
  await expect(page.getByTestId("home-progress-text")).toContainText("from 3 professionals with commissions");
  await expect(page.getByTestId("home-paid-amount")).toContainText("40.000");
  await expect(page.getByTestId("home-paid")).toContainText("1 professional");
  await expect(page.getByTestId("home-pending-amount")).toContainText("80.000");
  await expect(page.getByTestId("home-pending")).toContainText("2 professionals");

  // The bar has a legend with the money of each state.
  await expect(page.getByTestId("home-bar")).toBeVisible();
  for (const [state, label] of [
    ["UNSETTLED", "Not settled"],
    ["DRAFT", "Draft"],
    ["APPROVED", "Approved"],
    ["PAID", "Paid"],
  ] as const) {
    await expect(page.getByTestId(`home-legend-${state}`)).toContainText(label);
  }
  await expect(page.getByTestId("home-legend-PAID")).toContainText("40.000");

  // «What is left to do»: people and money per step, and the next action.
  await expect(page.getByTestId("home-step-UNSETTLED").getByTestId("home-step-people")).toHaveText("1 professional");
  await expect(page.getByTestId("home-step-UNSETTLED").getByTestId("home-step-amount")).toContainText("40.000 to generate");
  await expect(page.getByTestId("home-step-DRAFT").getByTestId("home-step-amount")).toContainText("40.000 to approve");
  await expect(page.getByTestId("home-step-APPROVED").getByTestId("home-step-people")).toHaveText("0 professionals");
  await expect(page.getByTestId("home-step-APPROVED")).toContainText("Nothing to do");
  await expect(page.getByTestId("home-step-PAID-action")).toHaveText("See payments");
  await page.getByTestId("home-step-DRAFT-action").click();
  await expect(page).toHaveURL(/\/app\/commissions\/liquidar\?state=DRAFT$/);
  await expect(page.getByTestId("liquidar-row")).toHaveCount(1);
});

test("AC5 · «Tu equipo» cuenta las activas, las que tienen comisiones y nombra a las que no tienen movimientos", async ({ page, request }) => {
  await team(request);
  await loginAdminUi(page, w);
  await openCommissions(page);

  await expect(page.getByTestId("home-team-counts")).toHaveText("5 active professionals · 3 with commissions · 2 without movements");
  await expect(page.getByTestId("home-team-row")).toHaveCount(3);
  await expect(page.getByTestId("home-team-none")).toContainText("2 professionals without movements this period:");
  await expect(page.getByTestId("home-team-none")).toContainText("Rosa", { ignoreCase: true });
  await expect(page.getByTestId("home-team-none")).toContainText("Tomás", { ignoreCase: true });
  await page.getByTestId("home-team-none-link").click();
  await expect(page).toHaveURL(/\/liquidar\?state=NONE$/);
  // The names of those without movements are already open.
  await expect(page.getByTestId("liquidar-none-item")).toHaveCount(2);
});

// ── AC6 · Equipo ──────────────────────────────────────────────────────────────────────────────

test("AC6 · Equipo cuenta las activas, muestra el estado de cada una y filtra Pagadas y Sin movimientos", async ({ page, request }) => {
  await team(request);
  await loginAdminUi(page, w);
  await openCommissions(page, "team");

  await expect(page.getByTestId("team-counts")).toHaveText("5 active professionals · 3 with commissions · 2 without movements");
  await expect(page.getByTestId("team-card")).toHaveCount(5);
  const rosa = page.getByTestId("team-card").filter({ hasText: "Rosa" });
  await expect(rosa.getByTestId("status-chip")).toHaveText("No movements");
  await expect(rosa.getByTestId("team-card-amount")).toHaveText("—");
  await expect(rosa.getByTestId("team-card-detail")).toHaveText("No sales this period");
  const ana = page.getByTestId("team-card").filter({ hasText: w.ana.name });
  await expect(ana.getByTestId("team-card-detail")).toContainText("Paid on");
  await expect(page.getByTestId("team-card").filter({ hasText: "Carla" }).getByTestId("team-card-detail")).toContainText("to generate");

  await page.getByTestId("team-filter-paid").click();
  await expect(page.getByTestId("team-card")).toHaveCount(1);
  await page.getByTestId("team-filter-none").click();
  await expect(page.getByTestId("team-card")).toHaveCount(2);
  await page.getByTestId("team-filter-pending").click();
  await expect(page.getByTestId("team-card")).toHaveCount(2); // Bea (draft) and Carla (unsettled)
});

// ── AC7 · Celular ─────────────────────────────────────────────────────────────────────────────

test("AC7 · en el celular Inicio y Liquidar se leen sin scroll horizontal", async ({ page, request }) => {
  await team(request);
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAdminUi(page, w);
  await page.goto("/app/commissions");
  await expect(page.getByTestId("home-hero")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  await expect(page.getByTestId("home-step-UNSETTLED")).toBeVisible();
  await page.goto("/app/commissions/liquidar");
  await expect(page.getByTestId("liquidar-tabs")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
});

// ── AC8 · API ─────────────────────────────────────────────────────────────────────────────────

test("AC8 · GET /overview devuelve a todas las activas, con cuántos movimientos tiene cada una y el día de pago", async ({ request }) => {
  await team(request);
  const o = await apiGetJson<Overview>(request, w.adminToken, "/api/commissions/overview");
  expect(o.rows).toHaveLength(5);
  const by = (name: string) => o.rows.find((r) => r.professionalName.toLowerCase().includes(name.toLowerCase()))!;
  expect(by("Carla")).toMatchObject({ status: "UNSETTLED", lineCount: 1, paidOn: null });
  expect(by("Rosa")).toMatchObject({ status: "NONE", lineCount: 0, paidOn: null });
  expect(by(w.ana.name)).toMatchObject({ status: "PAID", lineCount: 1, paidOn: todayYmd() });
  expect(by(w.bea.name)).toMatchObject({ status: "DRAFT", lineCount: 1, paidOn: null });
});
