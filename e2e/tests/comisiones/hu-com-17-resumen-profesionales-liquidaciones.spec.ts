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
  // Groups and rules so the home is not the first-time guide.
  const g = await createGroup(request, w.adminToken, "Peluquería");
  await assignToGroup(request, w.adminToken, g.id, [w.service.id, w.service2.id]);
  await applyChanges(request, w.adminToken, [
    { scope: "GROUP_RULE", groupId: g.id, professionalId: w.ana.id, value: "40" },
    { scope: "GROUP_RULE", groupId: g.id, professionalId: w.bea.id, value: "40" },
  ]);
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

test("AC1 · Liquidar muestra a TODAS las profesionales activas; las sin movimientos van al final con su motivo", async ({ page, request }) => {
  await team(request);
  await loginAdminUi(page, w);
  await openCommissions(page, "settle");

  // 5 active professionals: 3 with commissions and 2 without sales this period.
  await expect(page.getByTestId("liquidar-row")).toHaveCount(5);
  await expect(page.getByTestId("liquidar-scope")).toContainText("All 5 active professionals are shown.");
  await expect(page.getByTestId("liquidar-scope")).toContainText("3 have commissions this period; the other 2 have nothing to settle");
  const order = await page.getByTestId("liquidar-row").evaluateAll((els) => els.map((e) => e.getAttribute("data-status")));
  expect(order).toEqual(["UNSETTLED", "DRAFT", "PAID", "NONE", "NONE"]);

  const rosa = liquidarRow(page, "Rosa");
  await expect(rosa).toContainText("No sales this period");
  await expect(rosa.getByTestId("liquidar-row-amount")).toHaveText("—");
  await expect(rosa.getByTestId("liquidar-row-check")).toHaveCount(0);
  await expect(rosa.getByRole("button")).toHaveCount(0);
  // Rosa has no rules of her own: the row says so.
  await expect(rosa).toContainText("no rules of their own");

  // The filter «No movements» lists just them.
  await expect(page.getByTestId("liquidar-filter-NONE")).toContainText("No movements · 2");
  await page.getByTestId("liquidar-filter-NONE").click();
  await expect(page.getByTestId("liquidar-row")).toHaveCount(2);
  await expect(page.getByTestId("liquidar-filter-ALL")).toContainText("5");
});

// ── AC2 · Cada fila dice qué hay detrás de su monto ───────────────────────────────────────────

test("AC2 · cada fila dice qué hay detrás: movimientos, liquidación o cuándo se pagó; hay subtotal por tramo", async ({ page, request }) => {
  const t = await team(request);
  await loginAdminUi(page, w);
  await openCommissions(page, "settle");

  await expect(liquidarRow(page, "Carla").getByTestId("liquidar-row-note")).toHaveText("1 movement");
  await expect(liquidarRow(page, w.bea.name).getByTestId("liquidar-row-note")).toContainText("Settlement #");
  await expect(liquidarRow(page, w.ana.name).getByTestId("liquidar-row-note")).toContainText("Paid on");
  await expect(page.getByTestId("liquidar-group-UNSETTLED-subtotal")).toContainText("40.000 to generate");
  await expect(page.getByTestId("liquidar-group-DRAFT-subtotal")).toContainText("40.000 to approve");
  await expect(page.getByTestId("liquidar-group-PAID-subtotal")).toContainText("40.000 already collected");
  await expect(page.getByTestId("liquidar-group-NONE-subtotal")).toContainText("Nothing to settle this period");
  // The steps say how much money is in each, and the total says how much is already paid.
  await expect(page.getByTestId("liquidar-step-1-amount")).toContainText("40.000");
  await expect(page.getByTestId("liquidar-step-2-amount")).toContainText("40.000");
  await expect(page.getByTestId("liquidar-step-3-amount")).toContainText("0");
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
  await expect(page.getByTestId("liquidar-row")).toHaveCount(2);
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
  await expect(page.getByTestId("liquidar-scope")).toBeVisible();
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
