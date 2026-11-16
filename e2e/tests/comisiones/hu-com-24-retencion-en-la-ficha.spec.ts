import { expect, test, type Page } from "@playwright/test";
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
  openSetupStep,
  provisionCommissionWorld,
  restoreCommissionsGlobal,
  type CommissionWorld,
} from "../../fixtures/commissions";

/**
 * HU-COM-24 · «Aguinaldo» pasa a llamarse «Retención»; la ficha de la profesional muestra lo que se paga y lo
 * retenido en el Resumen, sin solapa «Aguinaldo», y «Historial» pasa a «Movimientos»
 * (requirements/user_stories/HU-COM-24-retencion-en-la-ficha.md).
 */
let w: CommissionWorld;

test.beforeAll(async ({ request }) => {
  await enableCommissionsGlobally(request);
});

test.afterAll(async ({ request }) => {
  await restoreCommissionsGlobal(request);
});

test.beforeEach(async ({ request }) => {
  w = await provisionCommissionWorld(request, "HU-COM-24");
  await applyChanges(request, w.adminToken, [{ scope: "BASE", value: "TAX_INCLUDED" }]);
});

type Req = Parameters<typeof issueInvoice>[0];

/** The group pays 50 %, Ana retains 5 %: a sale of 100.000 pays her 45.000 and retains 5.000. */
async function salon(request: Req, opts: { retention?: boolean } = {}) {
  const retention = opts.retention ?? true;
  const g = await createGroup(request, w.adminToken, "Peluquería");
  await assignToGroup(request, w.adminToken, g.id, [w.service.id]);
  await applyChanges(request, w.adminToken, [
    { scope: "GROUP_RULE", groupId: g.id, value: "50" },
    ...(retention
      ? [
          { scope: "AGUINALDO_ENABLED" as const, value: "true" },
          { scope: "RETENTION_PROFILE" as const, professionalId: w.ana.id, value: "5" },
        ]
      : []),
  ]);
  const inv = await issueInvoice(request, w.adminToken, [{ serviceId: w.service.id, name: w.service.name, price: 100000, professionalId: w.ana.id }]);
  await entriesOfInvoice(request, w.adminToken, inv.id, 1);
}

/** Approves her settlement, so what was retained goes into her balance. */
async function approveSettlement(request: Req) {
  const [s] = await generateSettlements(request, w.adminToken, [w.ana.id]);
  await approveSettlementApi(request, w.adminToken, s.id);
}

async function openAna(page: Page, tab?: "summary" | "rules" | "history") {
  await loginAdminUi(page, w);
  await openCommissions(page);
  await openProfessional(page, w.ana.name, tab);
}

// ── AC1 · el cambio de nombre ────────────────────────────────────────────────────────────────────

test("AC1 · «Aguinaldo» pasa a «Retención» en Equipo, en Configurar y en Inicio", async ({ page, request }) => {
  await salon(request);
  await approveSettlement(request);
  await loginAdminUi(page, w);

  await openCommissions(page);
  await expect(page.getByTestId("home-aguinaldo")).toContainText("Retention balance");
  await expect(page.getByTestId("home-aguinaldo")).not.toContainText(/aguinaldo/i);

  await openCommissions(page, "team");
  await expect(page.getByTestId("team-tab-aguinaldo")).toHaveText("Retention");
  await page.getByTestId("team-tab-aguinaldo").click();
  await expect(page.getByTestId("commission-aguinaldo")).not.toContainText(/aguinaldo/i);
  await expect(page.getByTestId("aguinaldo-pay-all")).toBeVisible();

  await openCommissions(page, "setup");
  await openSetupStep(page, 3);
  await expect(page.getByTestId("config-step-3")).toContainText("Retention and product cost");
  await expect(page.getByTestId("config-step-3")).not.toContainText(/aguinaldo/i);
  await expect(page.getByTestId("commission-setting-AGUINALDO_ENABLED")).toContainText("Retention");
});

// ── AC2 · tres solapas ───────────────────────────────────────────────────────────────────────────

test("AC2 · la ficha tiene tres solapas: Resumen, Reglas y Movimientos (ya no hay «Aguinaldo» ni «Historial»)", async ({ page, request }) => {
  await salon(request);
  await openAna(page);

  await expect(page.locator("[data-testid^='pro-tab-']")).toHaveText(["Summary", "Rules", "Movements"]);
  await expect(page.getByTestId("pro-tab-aguinaldo")).toHaveCount(0);
  await expect(page.getByTestId("pro-tab-history")).toHaveText("Movements");
});

// ── AC3 · AC4 · AC5 · el Resumen con las dos tarjetas ────────────────────────────────────────────

test("AC3 · AC4 · AC5 · el Resumen muestra lo que se paga y lo retenido; desde ahí se paga y se ajusta la retención", async ({ page, request }) => {
  await salon(request);
  await approveSettlement(request); // 5.000 go to her balance
  await openAna(page);

  // Two cards: what is paid this period and what was retained.
  await expect(page.getByTestId("pro-summary-total")).toContainText("45.000");
  const card = page.getByTestId("pro-retention-card");
  await expect(card).toContainText("Retained this period");
  await expect(card.getByTestId("pro-summary-retained")).toContainText("5.000");
  await expect(card.getByTestId("pro-retention-pill")).toHaveText("5 % of each commission");
  await expect(card).toContainText("It is added to the balance when the settlement is approved");
  await expect(card.getByTestId("pro-retention-balance")).toContainText("5.000");
  await expect(card.getByTestId("pro-retention-last-payment")).toHaveText("—");
  await expect(card).not.toContainText(/aguinaldo/i);

  // AC4 · pay part of the balance from the Summary.
  await page.getByTestId("pro-retention-pay").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Pay retention · ");
  await expect(dialog).toContainText("5.000");
  await page.getByTestId("aguinaldo-mode-PARTIAL").check();
  await page.getByTestId("aguinaldo-amount").fill("2000");
  await page.getByTestId("aguinaldo-pay-confirm").click();
  await expect(page.getByTestId("pro-retention-notice")).toHaveText("The retention payment was recorded.");
  await expect(card.getByTestId("pro-retention-balance")).toContainText("3.000");
  await expect(card.getByTestId("pro-retention-last-payment")).not.toHaveText("—");

  // AC5 · adjust the balance from the Summary.
  await page.getByTestId("pro-retention-adjust").click();
  await page.getByTestId("aguinaldo-adjust-amount").fill("-1000");
  await page.getByTestId("aguinaldo-adjust-reason").fill("Corrección de una venta anulada");
  await page.getByTestId("aguinaldo-adjust-confirm").click();
  await expect(page.getByTestId("pro-retention-notice")).toHaveText("The adjustment was recorded.");
  await expect(card.getByTestId("pro-retention-balance")).toContainText("2.000");
});

// ── AC6 · AC7 · Movimientos con el interruptor ───────────────────────────────────────────────────

test("AC6 · AC7 · Movimientos abre en Comisiones y el interruptor Comisiones | Retención muestra el saldo y los movimientos de la retención", async ({
  page,
  request,
}) => {
  await salon(request);
  await approveSettlement(request);
  await openAna(page);

  // The link of the Summary leads to the retention list.
  await page.getByTestId("pro-retention-movements-link").click();
  await expect(page).toHaveURL(/tab=history&view=retention/);
  await expect(page.getByTestId("pro-movements-view-retention")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("aguinaldo-balance")).toContainText("5.000");
  const moves = page.getByTestId("aguinaldo-movement");
  await expect(moves).toHaveCount(1);
  await expect(moves.first()).toContainText("5.000");
  await expect(page.getByTestId("aguinaldo-pay")).toHaveText("Pay retention");
  await expect(page.getByTestId("aguinaldo-adjust")).toHaveText("Adjust the balance");
  await expect(page.getByTestId("commission-aguinaldo")).not.toContainText(/aguinaldo/i);

  // Back to the commissions (the list of HU-COM-23), where the line explains the retention.
  await page.getByTestId("pro-movements-view-commissions").click();
  await expect(page.getByTestId("pro-movements-view-commissions")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("movement-row")).toHaveCount(1);
  await expect(page.getByTestId("movement-row").first()).toContainText("Service 50 % → paid 45 % · retention 5 % (Gs. 5.000)");

  // By default (from the tab) it opens on the commissions.
  await page.getByTestId("pro-tab-summary").click();
  await page.getByTestId("pro-tab-history").click();
  await expect(page.getByTestId("pro-movements-view-commissions")).toHaveAttribute("aria-pressed", "true");
});

test("AC8 · la dirección vieja de la solapa «Aguinaldo» abre la lista de Retención de Movimientos", async ({ page, request }) => {
  await salon(request);
  await approveSettlement(request);
  await loginAdminUi(page, w);
  await openCommissions(page);
  await openProfessional(page, w.ana.name);
  const url = new URL(page.url());
  await page.goto(`${url.pathname}?tab=aguinaldo`);
  await expect(page.getByTestId("pro-movements-view-retention")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("aguinaldo-balance")).toContainText("5.000");
});

// ── AC9 · sin retención ──────────────────────────────────────────────────────────────────────────

test("AC9 · si el salón no retiene no hay tarjeta de retención, ni acciones, ni interruptor en Movimientos", async ({ page, request }) => {
  await salon(request, { retention: false });
  await openAna(page);

  await expect(page.getByTestId("pro-summary-total")).toContainText("50.000");
  await expect(page.getByTestId("pro-retention-card")).toHaveCount(0);
  await expect(page.getByTestId("pro-retention-pay")).toHaveCount(0);
  await expect(page.getByTestId("pro-retention-movements-link")).toHaveCount(0);

  await page.getByTestId("pro-tab-history").click();
  await expect(page.getByTestId("commission-movements")).toBeVisible();
  await expect(page.getByTestId("pro-movements-view-retention")).toHaveCount(0);
  await expect(page.locator("[data-testid^='pro-tab-']")).toHaveText(["Summary", "Rules", "Movements"]);
});

// ── AC10 · celular ───────────────────────────────────────────────────────────────────────────────

test("AC10 · en el celular las dos tarjetas se apilan sin desbordar y los botones miden al menos 44 px", async ({ page, request }) => {
  await salon(request);
  await approveSettlement(request);
  await openAna(page);
  await page.setViewportSize({ width: 390, height: 844 });

  await expect(page.getByTestId("pro-retention-card")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  const pay = await page.getByTestId("pro-retention-pay").boundingBox();
  const settle = await page.getByTestId("pro-summary-go-settle").or(page.getByTestId("pro-summary-open-settlement")).first().boundingBox();
  expect(pay!.height).toBeGreaterThanOrEqual(44);
  expect(settle!.height).toBeGreaterThanOrEqual(44);
  // The pay card is above the retention card (stacked), not side by side.
  const payCard = await page.getByTestId("pro-pay-card").boundingBox();
  const retentionCard = await page.getByTestId("pro-retention-card").boundingBox();
  expect(retentionCard!.y).toBeGreaterThan(payCard!.y + payCard!.height - 2);
});
