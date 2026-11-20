import { expect, test, type Page } from "@playwright/test";
import { API_BASE } from "../../fixtures/api";
import {
  applyChanges,
  assignToGroup,
  createGroup,
  enableCommissionsGlobally,
  entriesOfInvoice,
  issueInvoice,
  loginAdminUi,
  openCommissions,
  provisionCommissionWorld,
  restoreCommissionsGlobal,
  voidInvoice,
  type CommissionWorld,
} from "../../fixtures/commissions";

/**
 * HU-COM-29 · Movimientos: las líneas revertidas se entienden
 * (requirements/user_stories/HU-COM-29-movimientos-lineas-revertidas.md).
 */
let w: CommissionWorld;

test.beforeAll(async ({ request }) => {
  await enableCommissionsGlobally(request);
});

test.afterAll(async ({ request }) => {
  await restoreCommissionsGlobal(request);
});

test.beforeEach(async ({ request }) => {
  w = await provisionCommissionWorld(request, "HU-COM-29");
  await applyChanges(request, w.adminToken, [{ scope: "BASE", value: "TAX_INCLUDED" }]);
});

type Req = Parameters<typeof issueInvoice>[0];

/** Group at 50 %, Ana retains 5 %. */
async function salon(request: Req) {
  const g = await createGroup(request, w.adminToken, "Peluquería");
  await assignToGroup(request, w.adminToken, g.id, [w.service.id]);
  await applyChanges(request, w.adminToken, [
    { scope: "AGUINALDO_ENABLED", value: "true" },
    { scope: "RETENTION_PROFILE", professionalId: w.ana.id, value: "5" },
    { scope: "GROUP_RULE", groupId: g.id, value: "50" },
  ]);
  return g;
}

async function sale(request: Req, professionalId: number, price = 100000) {
  const inv = await issueInvoice(request, w.adminToken, [{ serviceId: w.service.id, name: w.service.name, price, professionalId }]);
  await entriesOfInvoice(request, w.adminToken, inv.id, 1);
  return inv;
}

/** Ana's retention goes from 5 % to 10 % from the start of the period: her open line is recalculated (45 % → 40 %). */
async function recalculateAna(request: Req) {
  await applyChanges(request, w.adminToken, [{ scope: "RETENTION_PROFILE", professionalId: w.ana.id, value: "10" }], "PERIOD_START");
}

/** One recalculated sale (Ana), one plain sale of Bea and one voided sale of Ana. */
async function threeSales(request: Req) {
  await salon(request);
  const voided = await sale(request, w.ana.id, 80000);
  await sale(request, w.bea.id, 60000); // 30.000, nothing special
  await sale(request, w.ana.id, 100000); // 45.000 → 40.000
  await voidInvoice(request, w.adminToken, voided.id);
  await recalculateAna(request);
}

async function openMovements(page: Page) {
  await loginAdminUi(page, w);
  await openCommissions(page, "activity");
  await page.getByTestId("activity-tab-movements").click();
  await expect(page.getByTestId("commission-movements")).toBeVisible();
}

const rows = (page: Page) => page.getByTestId("movement-row");

// ── AC1 · una fila por venta ──────────────────────────────────────────────────────────────────────

test("AC1 · una venta recalculada es una sola fila: la comisión vigente, su etiqueta y «before 45 %»", async ({ page, request }) => {
  await salon(request);
  await sale(request, w.ana.id);
  await recalculateAna(request);
  await openMovements(page);

  await expect(rows(page)).toHaveCount(1);
  const row = rows(page).first();
  await expect(row.getByTestId("movement-tag")).toHaveText("Recalculated");
  await expect(row.getByTestId("movement-amount")).toHaveText("Gs. 40.000");
  await expect(row.getByTestId("movement-calc-note")).toHaveText("before 45 %");
  await expect(row.getByTestId("movement-changes")).toHaveCount(0); // the history is closed by default
});

// ── AC2 · AC4 · ver cambios y el interruptor ──────────────────────────────────────────────────────

test("AC2 · «See changes» abre el recorrido en orden (original revertida → reversión → vigente) con el neto, y se cierra", async ({
  page,
  request,
}) => {
  await threeSales(request);
  await openMovements(page);

  const row = rows(page).filter({ hasText: "Recalculated" });
  const toggle = row.getByTestId("movement-changes-toggle");
  await expect(toggle).toContainText("See changes · 3 rows");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const steps = row.getByTestId("movement-step");
  await expect(steps).toHaveCount(3);
  await expect(steps.nth(0)).toHaveAttribute("data-kind", "reverted");
  await expect(steps.nth(0)).toContainText("Initial commission");
  await expect(steps.nth(0)).toContainText("Reversed");
  await expect(steps.nth(1)).toHaveAttribute("data-kind", "reversal");
  await expect(steps.nth(1)).toContainText("Reversal: recalculation");
  await expect(steps.nth(1)).toContainText("undoes step 1");
  await expect(steps.nth(2)).toHaveAttribute("data-kind", "current");
  await expect(steps.nth(2)).toContainText("In force");
  await expect(row.getByTestId("movement-changes-net")).toHaveText("Net of this sale: Gs. 40.000.");
  await toggle.click();
  await expect(row.getByTestId("movement-changes")).toHaveCount(0);
});

test("AC4 · el interruptor «Also show reversed lines» abre el recorrido de todas las ventas a la vez", async ({ page, request }) => {
  await threeSales(request);
  await openMovements(page);

  await expect(page.getByTestId("movement-changes")).toHaveCount(0);
  const sw = page.getByTestId("movements-show-reversed");
  await expect(sw).toHaveAttribute("aria-checked", "false");
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("movement-changes")).toHaveCount(2); // the recalculated and the voided one
  await sw.click();
  await expect(page.getByTestId("movement-changes")).toHaveCount(0);
});

// ── AC3 · venta anulada ───────────────────────────────────────────────────────────────────────────

test("AC3 · una venta cuyo comprobante se anuló queda en Gs. 0, «Voided» y sin comisión vigente", async ({ page, request }) => {
  await threeSales(request);
  await openMovements(page);

  const voided = rows(page).filter({ hasText: "Voided" });
  await expect(voided).toHaveCount(1);
  await expect(voided.getByTestId("movement-amount")).toHaveText("Gs. 0");
  await expect(voided.getByTestId("movement-calc-note")).toHaveText("invoice voided");
  await voided.getByTestId("movement-changes-toggle").click();
  await expect(voided.getByTestId("movement-changes-net")).toContainText("There is no commission in force.");
});

// ── AC5 · AC6 · lo demás no cambia; totales y filtros por venta ──────────────────────────────────

test("AC5 · AC6 · la venta sin cambios no tiene etiqueta ni «See changes»; el pie suma el neto y cuenta las ventas con cambios", async ({
  page,
  request,
}) => {
  await threeSales(request);
  await openMovements(page);

  await expect(rows(page)).toHaveCount(3); // three sales, not seven rows
  await expect(page.getByTestId("movements-pay-all")).toHaveText("All · 3");
  const plain = rows(page).filter({ hasText: w.bea.name });
  await expect(plain.getByTestId("movement-tag")).toHaveCount(0);
  await expect(plain.getByTestId("movement-changes-toggle")).toHaveCount(0);
  await expect(plain.getByTestId("movement-amount")).toHaveText("Gs. 30.000");
  // 30.000 (Bea) + 40.000 (Ana, recalculated) + 0 (voided): the reversals subtract what they undo.
  await expect(page.getByTestId("movements-total-amount")).toHaveText("Gs. 70.000");
  await expect(page.getByTestId("movements-changed-count")).toHaveText("2 with changes");
});

// ── AC7 · cambiar profesional solo en lo vigente ─────────────────────────────────────────────────

test("AC7 · «Change professional» está solo en la fila de la comisión vigente", async ({ page, request }) => {
  await threeSales(request);
  await openMovements(page);

  const recalculated = rows(page).filter({ hasText: "Recalculated" });
  await expect(recalculated.getByRole("button", { name: /actions/i })).toHaveCount(1);
  const voided = rows(page).filter({ hasText: "Voided" });
  await expect(voided.getByRole("button", { name: /actions/i })).toHaveCount(0);
});

// ── AC8 · celular ─────────────────────────────────────────────────────────────────────────────────

test("AC8 · en el celular la tarjeta muestra la etiqueta, «See changes» abre el recorrido y no se desborda la página", async ({ page, request }) => {
  await threeSales(request);
  await openMovements(page);
  await page.setViewportSize({ width: 390, height: 844 });

  const row = rows(page).filter({ hasText: "Recalculated" });
  await expect(row.getByTestId("movement-tag")).toBeVisible();
  const toggle = row.getByTestId("movement-changes-toggle");
  const box = await toggle.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  await toggle.click();
  await expect(row.getByTestId("movement-step")).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
});

// ── AC10 · API ────────────────────────────────────────────────────────────────────────────────────

test("AC10 · cada fila de la API trae invoiceLineId y las tres filas de la venta recalculada lo comparten", async ({ request }) => {
  await threeSales(request);
  const res = await request.get(`${API_BASE}/api/commissions/entries`, {
    headers: { Authorization: `Bearer ${w.adminToken}` },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const all = (await res.json()) as { invoiceLineId: number | null; sourceType: string; professionalId: number }[];
  const lines = all.filter((e) => e.sourceType !== "ADJUSTMENT");
  expect(lines.every((e) => e.invoiceLineId !== null)).toBe(true);
  const counts = new Map<number, number>();
  for (const e of lines) counts.set(e.invoiceLineId!, (counts.get(e.invoiceLineId!) ?? 0) + 1);
  // Recalculated sale: 3 rows; voided sale: 2 rows; plain sale: 1 row.
  expect([...counts.values()].sort()).toEqual([1, 2, 3]);
});
