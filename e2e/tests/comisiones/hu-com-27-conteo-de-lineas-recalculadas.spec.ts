import { expect, test } from "@playwright/test";
import {
  applyChanges,
  assignToGroup,
  createGroup,
  enableCommissionsGlobally,
  entriesOfInvoice,
  issueInvoice,
  liquidarRow,
  loginAdminUi,
  openCommissions,
  openProfessional,
  provisionCommissionWorld,
  restoreCommissionsGlobal,
  type CommissionWorld,
} from "../../fixtures/commissions";

/**
 * HU-COM-27 · Una línea recalculada se cuenta una sola vez
 * (requirements/user_stories/HU-COM-27-conteo-de-lineas-recalculadas.md).
 */
let w: CommissionWorld;

test.beforeAll(async ({ request }) => {
  await enableCommissionsGlobally(request);
});

test.afterAll(async ({ request }) => {
  await restoreCommissionsGlobal(request);
});

test.beforeEach(async ({ request }) => {
  w = await provisionCommissionWorld(request, "HU-COM-27");
  await applyChanges(request, w.adminToken, [{ scope: "BASE", value: "TAX_INCLUDED" }]);
});

type Req = Parameters<typeof issueInvoice>[0];

/** One invoice of 100.000 at 50 %; then Ana's retention (5 %) is set from the start of the period: the line is recalculated. */
async function recalculatedSale(request: Req) {
  const g = await createGroup(request, w.adminToken, "Peluquería");
  await assignToGroup(request, w.adminToken, g.id, [w.service.id]);
  await applyChanges(request, w.adminToken, [
    { scope: "AGUINALDO_ENABLED", value: "true" },
    { scope: "GROUP_RULE", groupId: g.id, value: "50" },
  ]);
  const inv = await issueInvoice(request, w.adminToken, [{ serviceId: w.service.id, name: w.service.name, price: 100000, professionalId: w.ana.id }]);
  await entriesOfInvoice(request, w.adminToken, inv.id, 1);
  await applyChanges(request, w.adminToken, [{ scope: "RETENTION_PROFILE", professionalId: w.ana.id, value: "5" }], "PERIOD_START");
}

test("AC1 · AC3 · el Resumen dice «1 invoiced line» y no cambia el importe de una venta recalculada", async ({ page, request }) => {
  await recalculatedSale(request);
  await loginAdminUi(page, w);
  await openCommissions(page);
  await openProfessional(page, w.ana.name);

  await expect(page.getByTestId("pro-summary-lines")).toHaveText("1 invoiced line");
  await expect(page.getByTestId("pro-summary-total")).toContainText("45.000"); // 50 % − 5 % retained
});

test("AC2 · Liquidar dice «1 movement» (no 3) para la venta recalculada", async ({ page, request }) => {
  await recalculatedSale(request);
  await loginAdminUi(page, w);
  await openCommissions(page, "settle");

  await expect(liquidarRow(page, w.ana.name).getByTestId("liquidar-row-note")).toHaveText("1 movement");
});

test("AC4 · Movimientos sigue mostrando las tres filas (comisión original, reversión y comisión nueva)", async ({ page, request }) => {
  await recalculatedSale(request);
  await loginAdminUi(page, w);
  await openCommissions(page);
  await openProfessional(page, w.ana.name, "history");

  await expect(page.getByTestId("movement-row")).toHaveCount(3);
});
