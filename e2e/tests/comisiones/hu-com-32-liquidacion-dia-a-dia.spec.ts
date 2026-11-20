import { expect, test, type Page } from "@playwright/test";
import {
  applyChanges,
  assignToGroup,
  createGroup,
  enableCommissionsGlobally,
  entriesOfInvoice,
  generateSettlements,
  issueInvoice,
  loginAdminUi,
  provisionCommissionWorld,
  restoreCommissionsGlobal,
  voidInvoice,
  type CommissionWorld,
} from "../../fixtures/commissions";

/**
 * HU-COM-32 · Liquidación: el detalle día a día
 * (requirements/user_stories/HU-COM-32-liquidacion-dia-a-dia.md).
 */
let w: CommissionWorld;

test.beforeAll(async ({ request }) => {
  await enableCommissionsGlobally(request);
});

test.afterAll(async ({ request }) => {
  await restoreCommissionsGlobal(request);
});

test.beforeEach(async ({ request }) => {
  w = await provisionCommissionWorld(request, "HU-COM-32");
  await applyChanges(request, w.adminToken, [{ scope: "BASE", value: "TAX_INCLUDED" }]);
});

type Req = Parameters<typeof issueInvoice>[0];

/** A service at 40 % and a product at 10 %: 40.000 + 10.000. */
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

/** Group at 50 %, Ana retains 5 %. */
async function salon(request: Req) {
  const g = await createGroup(request, w.adminToken, "Peluquería");
  await assignToGroup(request, w.adminToken, g.id, [w.service.id]);
  await applyChanges(request, w.adminToken, [
    { scope: "AGUINALDO_ENABLED", value: "true" },
    { scope: "RETENTION_PROFILE", professionalId: w.ana.id, value: "5" },
    { scope: "GROUP_RULE", groupId: g.id, value: "50" },
  ]);
}

async function sale(request: Req, price: number) {
  const inv = await issueInvoice(request, w.adminToken, [{ serviceId: w.service.id, name: w.service.name, price, professionalId: w.ana.id }]);
  await entriesOfInvoice(request, w.adminToken, inv.id, 1);
  return inv;
}

/** Ana: one voided sale, one sale recalculated (45 % → 40 %, her retention goes from 5 % to 10 %). */
async function recalculatedAndVoided(request: Req) {
  await salon(request);
  const voided = await sale(request, 80000);
  await sale(request, 100000);
  await voidInvoice(request, w.adminToken, voided.id);
  await applyChanges(request, w.adminToken, [{ scope: "RETENTION_PROFILE", professionalId: w.ana.id, value: "10" }], "PERIOD_START");
}

async function openDraft(page: Page, request: Req) {
  const [draft] = await generateSettlements(request, w.adminToken, [w.ana.id]);
  await loginAdminUi(page, w);
  await page.goto(`/app/commissions/settlements/${draft.id}`);
  await expect(page.getByTestId("commission-settlement-detail")).toBeVisible();
  return draft;
}

const detail = (page: Page) => page.getByTestId("commission-settlement-detail");
const rightEdge = async (loc: ReturnType<Page["locator"]>) => {
  const box = await loc.boundingBox();
  return Math.round((box?.x ?? 0) + (box?.width ?? 0));
};

// ── AC1 · la composición ──────────────────────────────────────────────────────────────────────────

test("AC1 · el encabezado muestra Servicios + Productos + Ajustes en una barra, y suman el total", async ({ page, request }) => {
  await plainSales(request);
  await openDraft(page, request);

  await expect(detail(page).getByTestId("settlement-total")).toContainText("50.000");
  const comp = detail(page).getByTestId("settlement-composition");
  await expect(comp.getByTestId("settlement-comp-services")).toContainText("Services");
  await expect(comp.getByTestId("settlement-comp-services")).toContainText("1 line");
  await expect(comp.getByTestId("settlement-comp-services")).toContainText("Gs. 40.000");
  await expect(comp.getByTestId("settlement-comp-products")).toContainText("Gs. 10.000");
  await expect(comp.getByTestId("settlement-comp-adjustments")).toHaveCount(0); // nothing to add up yet

  // Adding an adjustment makes it part of the sum and of the total.
  await page.getByTestId("settlement-adjustment-open").click();
  await page.locator("#adj-amount").fill("5000");
  await page.locator("#adj-reason").fill("Bono por desempeño");
  await page.getByTestId("settlement-add-adjustment").click();
  await expect(comp.getByTestId("settlement-comp-adjustments")).toContainText("1 adjustment");
  await expect(comp.getByTestId("settlement-comp-adjustments")).toContainText("+Gs. 5.000");
  await expect(detail(page).getByTestId("settlement-total")).toContainText("55.000");
});

// ── AC2 · AC5 · día a día ─────────────────────────────────────────────────────────────────────────

test("AC2 · AC5 · el detalle va por día, con el total del día; el ajuste aparece en su día con la etiqueta «Adjustment»", async ({ page, request }) => {
  await plainSales(request);
  await openDraft(page, request);

  const days = detail(page).getByTestId("settlement-day");
  await expect(days).toHaveCount(1); // everything happened today
  await expect(days.first()).toHaveAttribute("data-day", /^\d{4}-\d{2}-\d{2}$/);
  await expect(days.first().getByTestId("settlement-line")).toHaveCount(2);
  await expect(days.first().getByTestId("settlement-day-total")).toHaveText("Gs. 50.000");
  // The product is marked and each line says its invoice and calculation.
  await expect(days.first().getByTestId("settlement-line-product")).toHaveCount(1);
  await expect(days.first().getByTestId("settlement-line").first()).toContainText("Invoice");

  await page.getByTestId("settlement-adjustment-open").click();
  await page.locator("#adj-amount").fill("5000");
  await page.locator("#adj-reason").fill("Bono por desempeño");
  await page.getByTestId("settlement-add-adjustment").click();
  const adjustment = days.first().getByTestId("settlement-adjustment");
  await expect(adjustment).toHaveCount(1);
  await expect(adjustment).toContainText("Bono por desempeño");
  await expect(adjustment).toContainText("Adjustment");
  await expect(adjustment.getByTestId("settlement-adjustment-amount")).toContainText("+Gs. 5.000");
  await expect(days.first().getByTestId("settlement-day-total")).toHaveText("Gs. 55.000");
});

// ── AC3 · AC7 · una fila por venta ────────────────────────────────────────────────────────────────

test("AC3 · una venta recalculada es UNA fila (comisión vigente, «Recalculated», «before 45 %») y «See changes» abre el recorrido con el neto", async ({
  page,
  request,
}) => {
  await recalculatedAndVoided(request);
  await openDraft(page, request);

  const row = detail(page).getByTestId("settlement-line").filter({ hasText: "Recalculated" });
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId("settlement-line-amount")).toHaveText("Gs. 40.000");
  await expect(row).toContainText("before 45 %");
  await expect(row.getByTestId("settlement-sale-changes")).toHaveCount(0); // closed by default
  const toggle = row.getByTestId("settlement-line-changes-toggle");
  await expect(toggle).toContainText("See changes · 3 rows");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const steps = row.getByTestId("settlement-sale-step");
  await expect(steps).toHaveCount(3);
  await expect(steps.nth(0)).toHaveAttribute("data-kind", "reverted");
  await expect(steps.nth(0)).toContainText("Initial commission");
  await expect(steps.nth(1)).toHaveAttribute("data-kind", "reversal");
  await expect(steps.nth(1)).toContainText("Reversal: recalculation");
  await expect(steps.nth(1)).toContainText("undoes step 1");
  await expect(steps.nth(2)).toHaveAttribute("data-kind", "current");
  await expect(row.getByTestId("settlement-sale-changes-net")).toHaveText("Net of this sale: Gs. 40.000.");
  await toggle.click();
  await expect(row.getByTestId("settlement-sale-changes")).toHaveCount(0);

  // The voided sale is one row too, with no commission in force.
  const voided = detail(page).getByTestId("settlement-line").filter({ hasText: "Voided" });
  await expect(voided).toHaveCount(1);
  await expect(voided.getByTestId("settlement-line-amount")).toHaveText("Gs. 0");
});

// ── AC4 · AC7 · montos alineados y Cambiar profesional ────────────────────────────────────────────

test("AC4 · AC7 · los montos quedan en una columna alineada con y sin ⋮; «Change professional» solo en la comisión vigente de un borrador", async ({
  page,
  request,
}) => {
  await recalculatedAndVoided(request);
  await openDraft(page, request);

  const lines = detail(page).getByTestId("settlement-line");
  const count = await lines.count();
  expect(count).toBe(2);
  const edges = new Set<number>();
  for (let i = 0; i < count; i++) edges.add(await rightEdge(lines.nth(i).getByTestId("settlement-line-amount")));
  expect(edges.size).toBe(1); // the row with the kebab and the one without line up

  const recalculated = lines.filter({ hasText: "Recalculated" });
  const voided = lines.filter({ hasText: "Voided" });
  await expect(recalculated.getByRole("button", { name: /actions/i })).toHaveCount(1);
  await expect(voided.getByRole("button", { name: /actions/i })).toHaveCount(0);
  await recalculated.getByTestId("settlement-line-changes-toggle").click();
  await expect(recalculated.getByRole("button", { name: /actions/i })).toHaveCount(1); // not on the original nor the reversal

  // Once approved nothing can be reassigned or adjusted.
  await page.getByTestId("settlement-approve").click();
  await page.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
  await expect(detail(page).getByTestId("settlement-status")).toHaveText("Approved");
  await expect(lines.getByRole("button", { name: /actions/i })).toHaveCount(0);
  await expect(page.getByTestId("settlement-adjustment-open")).toHaveCount(0);
});

// ── AC6 · AC8 · lo que se va y lo que sigue ───────────────────────────────────────────────────────

test("AC6 · AC8 · ya no hay «Subtotales por tipo e ítem»; el historial, los botones y la retención siguen como antes", async ({ page, request }) => {
  await recalculatedAndVoided(request);
  await openDraft(page, request);

  await expect(page.getByTestId("settlement-subtotals-toggle")).toHaveCount(0);
  await expect(detail(page)).not.toContainText("Subtotals by type and item");
  await expect(detail(page).getByTestId("settlement-retained")).toBeVisible();
  await expect(detail(page).getByTestId("settlement-line-extra").first()).toContainText("Retention");
  await expect(page.getByTestId("settlement-approve")).toBeVisible();
  await expect(page.getByTestId("settlement-pdf")).toBeVisible();
  await expect(page.getByTestId("settlement-more-trigger")).toBeVisible();
  await page.getByTestId("settlement-history-toggle").click();
  await expect(page.getByTestId("settlement-history")).toContainText("Draft");
});

// ── AC9 · celular ─────────────────────────────────────────────────────────────────────────────────

test("AC9 · en el celular el día lleva su fecha como título, el cálculo debajo del ítem y nada desborda", async ({ page, request }) => {
  await recalculatedAndVoided(request);
  await page.setViewportSize({ width: 390, height: 844 });
  await openDraft(page, request);

  const day = detail(page).getByTestId("settlement-day").first();
  await expect(day.getByRole("heading", { level: 3 })).toBeVisible();
  const recalculated = day.getByTestId("settlement-line").filter({ hasText: "Recalculated" });
  await expect(recalculated).toContainText("× 40 %");
  await expect(recalculated.getByTestId("settlement-line-base")).toBeHidden(); // the column layout is for wide screens
  await recalculated.getByTestId("settlement-line-changes-toggle").click();
  await expect(recalculated.getByTestId("settlement-sale-step")).toHaveCount(3);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const toggleBox = await recalculated.getByTestId("settlement-line-changes-toggle").boundingBox();
  expect(toggleBox?.height ?? 0).toBeGreaterThanOrEqual(44);
});
