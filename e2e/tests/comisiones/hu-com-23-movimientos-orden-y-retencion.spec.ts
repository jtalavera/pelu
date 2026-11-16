import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  applyChanges,
  assignToGroup,
  createGroup,
  enableCommissionsGlobally,
  entriesOfInvoice,
  issueInvoice,
  loginAdminUi,
  openCommissions,
  openProfessional,
  provisionCommissionWorld,
  restoreCommissionsGlobal,
  type CommissionWorld,
} from "../../fixtures/commissions";

/**
 * HU-COM-23 · Movimientos: orden por fecha y retención explicada
 * (requirements/user_stories/HU-COM-23-movimientos-orden-y-retencion.md).
 */
let w: CommissionWorld;

test.beforeAll(async ({ request }) => {
  await enableCommissionsGlobally(request);
});

test.afterAll(async ({ request }) => {
  await restoreCommissionsGlobal(request);
});

test.beforeEach(async ({ request }) => {
  w = await provisionCommissionWorld(request, "HU-COM-23");
  await applyChanges(request, w.adminToken, [
    { scope: "BASE", value: "TAX_INCLUDED" },
    { scope: "DEFAULT_SERVICE", value: "40" },
  ]);
});

type Req = Parameters<typeof issueInvoice>[0];

async function sale(request: Req, professionalId: number, price = 100000) {
  const inv = await issueInvoice(request, w.adminToken, [{ serviceId: w.service.id, name: w.service.name, price, professionalId }]);
  await entriesOfInvoice(request, w.adminToken, inv.id, 1);
  return inv;
}

async function openMovements(page: Page) {
  await loginAdminUi(page, w);
  await openCommissions(page, "activity");
  await page.getByTestId("activity-tab-movements").click();
  await expect(page.getByTestId("commission-movements")).toBeVisible();
}

const rows = (page: Page) => page.getByTestId("movement-row");
const calcMain = (row: Locator) => row.getByTestId("movement-calc-main");
const calcExtra = (row: Locator) => row.getByTestId("movement-calc-extra");

// ── AC1 · AC2 · AC3 · orden por fecha ────────────────────────────────────────────────────────────

test("AC1 · AC2 · AC3 · Movimientos sale por defecto de lo más reciente a lo más antiguo, se puede invertir con «Ordenar» y vale para toda la lista", async ({
  page,
  request,
}) => {
  // 12 sales, each a bit bigger than the one before: the amount says which one is which (40 % of the price).
  for (let i = 0; i < 12; i++) await sale(request, w.ana.id, 100000 + i * 10000);
  await openMovements(page);

  // The default is newest first: the last sale (the biggest) is the first row of the first page.
  // HU-COM-25: there is no «Sort» list: the FECHA column header sorts (↓ newest first).
  await expect(page.getByTestId("movements-sort")).toHaveAttribute("data-order", "desc");
  await expect(page.getByTestId("movements-sort")).toContainText("Date");
  await expect(rows(page)).toHaveCount(10);
  await expect(rows(page).first()).toContainText("84.000"); // 40 % of 210.000
  await expect(rows(page).last()).toContainText("48.000"); // the 10th newest (40 % of 120.000)

  // The second page holds the oldest ones.
  await page.getByRole("button", { name: "Next" }).click();
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first()).toContainText("44.000");
  await expect(rows(page).last()).toContainText("40.000");

  // Reversing it goes back to the first page and starts with the oldest sale.
  await page.getByTestId("movements-sort").click();
  await expect(page.getByTestId("movements-sort")).toHaveAttribute("data-order", "asc");
  await expect(page.getByText("1–10 of 12")).toBeVisible();
  await expect(rows(page).first()).toContainText("40.000");
  await expect(rows(page).last()).toContainText("76.000"); // the 10th oldest (40 % of 190.000)

  // The order is kept when searching, and back to «Newest first» puts the biggest on top again.
  await page.getByTestId("movements-search").click();
  await expect(page.getByTestId("movements-sort")).toHaveAttribute("data-order", "asc");
  await expect(rows(page).first()).toContainText("40.000");
  await page.getByTestId("movements-sort").click();
  await expect(rows(page).first()).toContainText("84.000");

  // Touch target of at least 44 px.
  const box = await page.getByTestId("movements-sort").boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
});

// ── AC4 · AC5 · AC6 · la retención explicada ─────────────────────────────────────────────────────

test("AC4 · AC5 · con retención el cálculo dice «Servicio 50 % → 45 %» y debajo «Retención 5 % · Gs. 5.000»; al recalcular, la reversión queda arriba de la línea que reversa", async ({
  page,
  request,
}) => {
  const g = await createGroup(request, w.adminToken, "Peluquería");
  await assignToGroup(request, w.adminToken, g.id, [w.service.id]);
  await applyChanges(request, w.adminToken, [
    { scope: "AGUINALDO_ENABLED", value: "true" },
    { scope: "RETENTION_PROFILE", professionalId: w.ana.id, value: "5" },
    { scope: "GROUP_RULE", groupId: g.id, value: "50" },
  ]);
  await sale(request, w.ana.id); // 100.000 at 50 %: 45.000 paid, 5.000 to the aguinaldo fund
  await openMovements(page);

  await expect(rows(page)).toHaveCount(1);
  await expect(calcMain(rows(page).first())).toHaveText("Service 50 % → 45 %");
  await expect(calcExtra(rows(page).first())).toHaveText("Retention 5 % · Gs. 5.000");
  await expect(rows(page).first()).toContainText("Gs. 45.000");
  await expect(rows(page).first().getByTestId("movement-type")).toHaveText("Commission");

  // The salon changes the group to 60 %, from the start of the period: the open line is recalculated.
  await applyChanges(request, w.adminToken, [{ scope: "GROUP_RULE", groupId: g.id, value: "60" }], "PERIOD_START");
  await page.reload();
  await page.getByTestId("activity-tab-movements").click();
  await expect(rows(page)).toHaveCount(3);
  // Newest first: the new line (60 % → 55 % paid + 5 % retained), the reversal and the original line.
  await expect(calcMain(rows(page).nth(0))).toHaveText("Service 60 % → 55 %");
  await expect(calcExtra(rows(page).nth(0))).toHaveText("Retention 5 % · Gs. 5.000");
  await expect(rows(page).nth(0)).toContainText("Gs. 55.000");
  await expect(calcMain(rows(page).nth(1))).toHaveText("Service 50 % → 45 %");
  await expect(calcExtra(rows(page).nth(1))).toHaveText("Retention 5 % · Gs. -5.000");
  await expect(rows(page).nth(1)).toContainText("Gs. -45.000");
  await expect(calcMain(rows(page).nth(2))).toHaveText("Service 50 % → 45 %");
  await expect(calcExtra(rows(page).nth(2))).toHaveText("Retention 5 % · Gs. 5.000");
  await expect(rows(page).nth(2)).toContainText("Gs. 45.000");

  // The oldest first reads the other way round.
  await page.getByTestId("movements-sort").click();
  await expect(rows(page).nth(0)).toContainText("Gs. 45.000");
  await expect(rows(page).nth(2)).toContainText("Gs. 55.000");

  // The «History» tab of the professional is the same list: same order and same wording.
  await openProfessional(page, w.ana.name, "history");
  await expect(rows(page)).toHaveCount(3);
  await expect(calcMain(rows(page).first())).toHaveText("Service 60 % → 55 %");
  await expect(calcMain(rows(page).last())).toHaveText("Service 50 % → 45 %");
});

test("AC6 · sin retención la línea sigue diciendo solo la comisión y su %", async ({ page, request }) => {
  await sale(request, w.bea.id); // Bea retains nothing: 40 % of 100.000
  await openMovements(page);

  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first().getByTestId("movement-type")).toHaveText("Commission");
  await expect(calcMain(rows(page).first())).toHaveText("40 %");
  await expect(rows(page).first().getByTestId("movement-calc-extra")).toHaveCount(0);
  await expect(rows(page).first()).not.toContainText("→");
  await expect(rows(page).first()).toContainText("Gs. 40.000");
});
