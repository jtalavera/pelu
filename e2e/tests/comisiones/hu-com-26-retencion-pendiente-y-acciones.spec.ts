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
  provisionCommissionWorld,
  restoreCommissionsGlobal,
  type CommissionWorld,
} from "../../fixtures/commissions";

/**
 * HU-COM-26 · La retención pendiente se ve en Movimientos, y el Resumen de la ficha siempre ofrece pagar y ajustar
 * (requirements/user_stories/HU-COM-26-retencion-pendiente-y-acciones.md).
 */
let w: CommissionWorld;

test.beforeAll(async ({ request }) => {
  await enableCommissionsGlobally(request);
});

test.afterAll(async ({ request }) => {
  await restoreCommissionsGlobal(request);
});

test.beforeEach(async ({ request }) => {
  w = await provisionCommissionWorld(request, "HU-COM-26");
  await applyChanges(request, w.adminToken, [{ scope: "BASE", value: "TAX_INCLUDED" }]);
});

type Req = Parameters<typeof issueInvoice>[0];

/** The group pays 50 %, Ana retains 5 %: a sale of 100.000 pays her 45.000 and retains 5.000 (not settled yet). */
async function salon(request: Req) {
  const g = await createGroup(request, w.adminToken, "Peluquería");
  await assignToGroup(request, w.adminToken, g.id, [w.service.id]);
  await applyChanges(request, w.adminToken, [
    { scope: "AGUINALDO_ENABLED", value: "true" },
    { scope: "RETENTION_PROFILE", professionalId: w.ana.id, value: "5" },
    { scope: "GROUP_RULE", groupId: g.id, value: "50" },
  ]);
  const inv = await issueInvoice(request, w.adminToken, [{ serviceId: w.service.id, name: w.service.name, price: 100000, professionalId: w.ana.id }]);
  await entriesOfInvoice(request, w.adminToken, inv.id, 1);
}

async function openRetention(page: Page, name: string) {
  await loginAdminUi(page, w);
  await openCommissions(page);
  await openProfessional(page, name, "history");
  await page.getByTestId("pro-movements-view-retention").click();
  await expect(page.getByTestId("commission-aguinaldo")).toBeVisible();
}

// ── AC1 · AC2 · AC3 · el Resumen siempre ofrece pagar y ajustar ───────────────────────────────────

test("AC1 · AC2 · el Resumen muestra «Retiene 5 %» en el subtítulo y los botones de retención aunque todavía no haya saldo", async ({ page, request }) => {
  await salon(request); // nothing approved: she has no row in the fund yet
  await loginAdminUi(page, w);
  await openCommissions(page);
  await openProfessional(page, w.ana.name);

  await expect(page.getByTestId("pro-subtitle")).toContainText("Retains 5 %");
  await expect(page.getByTestId("pro-retention-balance")).toContainText("0");

  // «Pay retention» is there but disabled (nothing to pay yet) and says why; «Adjust the balance» is available.
  const pay = page.getByTestId("pro-retention-pay");
  await expect(pay).toBeVisible();
  await expect(pay).toBeDisabled();
  await expect(pay).toHaveAttribute("title", /no balance to pay yet/);
  await expect(page.getByTestId("pro-retention-nothing-to-pay")).toContainText("added when the settlement is approved");
  await expect(page.getByTestId("pro-retention-adjust")).toBeEnabled();
  await expect(page.getByTestId("pro-retention-movements-link")).toBeVisible();
});

test("AC3 · se puede ajustar el saldo desde el Resumen aun sin movimientos, y entonces «Pagar retención» se habilita", async ({ page, request }) => {
  await salon(request);
  await loginAdminUi(page, w);
  await openCommissions(page);
  await openProfessional(page, w.ana.name);

  await page.getByTestId("pro-retention-adjust").click();
  await page.getByTestId("aguinaldo-adjust-amount").fill("1000");
  await page.getByTestId("aguinaldo-adjust-reason").fill("Saldo inicial");
  await page.getByTestId("aguinaldo-adjust-confirm").click();
  await expect(page.getByTestId("pro-retention-notice")).toHaveText("The adjustment was recorded.");
  await expect(page.getByTestId("pro-retention-balance")).toContainText("1.000");
  await expect(page.getByTestId("pro-retention-pay")).toBeEnabled();
  await expect(page.getByTestId("pro-retention-nothing-to-pay")).toHaveCount(0);
});

// ── AC4 · AC5 · AC6 · Movimientos › Retención ────────────────────────────────────────────────────

test("AC4 · AC5 · Movimientos › Retención muestra lo retenido pendiente como una línea gris, primero «sin liquidar» y después «en un borrador»", async ({
  page,
  request,
}) => {
  await salon(request);
  await openRetention(page, w.ana.name);

  // Not settled yet: 5.000 wait, the balance is still 0.
  const pending = page.getByTestId("aguinaldo-pending");
  await expect(pending).toHaveCount(1);
  await expect(pending).toHaveAttribute("data-status", "UNSETTLED");
  await expect(pending).toContainText("Pending");
  await expect(pending).toContainText("Retention of this period · not settled");
  await expect(pending).toContainText("It is added to the balance when the settlement is approved");
  await expect(page.getByTestId("aguinaldo-pending-amount")).toHaveText("+ Gs. 5.000");
  await expect(page.getByTestId("aguinaldo-balance")).toContainText("0");
  await expect(page.getByTestId("aguinaldo-movements-empty")).toHaveCount(0); // the pending line already explains it
  await expect(page.getByTestId("aguinaldo-movement")).toHaveCount(0);
  await expect(page.getByTestId("aguinaldo-pay")).toBeDisabled();
  await expect(page.getByTestId("aguinaldo-adjust")).toBeEnabled();

  // In a draft: it says so.
  await generateSettlements(request, w.adminToken, [w.ana.id]);
  await page.reload();
  await page.getByTestId("pro-movements-view-retention").click();
  await expect(page.getByTestId("aguinaldo-pending")).toHaveAttribute("data-status", "DRAFT");
  await expect(page.getByTestId("aguinaldo-pending")).toContainText("in a draft, pending approval");
  await expect(page.getByTestId("aguinaldo-pending-amount")).toHaveText("+ Gs. 5.000");
});

test("AC6 · al aprobar la liquidación la línea pendiente pasa a ser un movimiento del saldo (ya no está pendiente)", async ({ page, request }) => {
  await salon(request);
  const [s] = await generateSettlements(request, w.adminToken, [w.ana.id]);
  await approveSettlementApi(request, w.adminToken, s.id);
  await openRetention(page, w.ana.name);

  await expect(page.getByTestId("aguinaldo-pending")).toHaveCount(0);
  await expect(page.getByTestId("aguinaldo-movement")).toHaveCount(1);
  await expect(page.getByTestId("aguinaldo-movement-amount")).toContainText("5.000");
  await expect(page.getByTestId("aguinaldo-balance")).toContainText("5.000");
  await expect(page.getByTestId("aguinaldo-pay")).toBeEnabled();
});

// ── AC7 · mensaje en lugar de la caja vacía ──────────────────────────────────────────────────────

test("AC7 · sin movimientos ni retención pendiente hay un mensaje en lugar de la caja vacía", async ({ page, request }) => {
  await salon(request);
  await openRetention(page, w.bea.name); // Bea has no sales and no retention

  await expect(page.getByTestId("aguinaldo-movements-empty")).toHaveText(
    "There are no retention movements yet. What is retained is added to the balance when the settlement is approved.",
  );
  await expect(page.getByTestId("aguinaldo-pending")).toHaveCount(0);
  await expect(page.getByTestId("aguinaldo-pay")).toBeDisabled();
  await expect(page.getByTestId("aguinaldo-adjust")).toBeEnabled();
});
