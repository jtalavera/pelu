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
  provisionCommissionWorld,
  restoreCommissionsGlobal,
  todayYmd,
  type CommissionWorld,
} from "../../fixtures/commissions";
import { apiPostJson } from "../../fixtures/api";

/**
 * HU-COM-25 · Movimientos en columnas, orden desde la columna FECHA y filtro de pago
 * (requirements/user_stories/HU-COM-25-movimientos-columnas-y-pago.md).
 */
let w: CommissionWorld;

test.beforeAll(async ({ request }) => {
  await enableCommissionsGlobally(request);
});

test.afterAll(async ({ request }) => {
  await restoreCommissionsGlobal(request);
});

test.beforeEach(async ({ request }) => {
  w = await provisionCommissionWorld(request, "HU-COM-25");
  await applyChanges(request, w.adminToken, [
    { scope: "BASE", value: "TAX_INCLUDED" },
    { scope: "DEFAULT_SERVICE", value: "40" },
  ]);
});

type Req = Parameters<typeof issueInvoice>[0];

async function sale(request: Req, professionalId: number, price = 100000) {
  const inv = await issueInvoice(request, w.adminToken, [{ serviceId: w.service.id, name: w.service.name, price, professionalId }]);
  const entries = await entriesOfInvoice(request, w.adminToken, inv.id, 1);
  return { inv, entry: entries[0] };
}

async function openMovements(page: Page) {
  await loginAdminUi(page, w);
  await openCommissions(page, "activity");
  await page.getByTestId("activity-tab-movements").click();
  await expect(page.getByTestId("commission-movements")).toBeVisible();
}

const rows = (page: Page) => page.getByTestId("movement-row");

/** Two professionals, three sales: Ana's is paid, Bea's one is in a draft and one is not settled yet. */
async function worldWithPayments(request: Req) {
  const g = await createGroup(request, w.adminToken, "Peluquería");
  await assignToGroup(request, w.adminToken, g.id, [w.service.id]);
  await applyChanges(request, w.adminToken, [
    { scope: "AGUINALDO_ENABLED", value: "true" },
    { scope: "RETENTION_PROFILE", professionalId: w.bea.id, value: "5" },
    { scope: "GROUP_RULE", groupId: g.id, value: "50" },
  ]);
  await sale(request, w.ana.id, 100000); // 50.000 for Ana → paid
  const [paid] = await generateSettlements(request, w.adminToken, [w.ana.id]);
  await approveSettlementApi(request, w.adminToken, paid.id);
  await apiPostJson(request, w.adminToken, `/api/commissions/settlements/${paid.id}/pay`, { paymentMethod: "CASH", paidOn: todayYmd(), paymentReference: "" });
  await sale(request, w.bea.id, 100000); // 45.000 (+ 5.000 retained) for Bea → draft
  await generateSettlements(request, w.adminToken, [w.bea.id]);
  await sale(request, w.bea.id, 200000); // 90.000 (+ 10.000 retained) → not settled
}

// ── AC1 · AC2 · columnas ─────────────────────────────────────────────────────────────────────────

test("AC1 · AC2 · la lista tiene siete columnas (fecha, ítem con comprobante, profesional, tipo, cálculo, estado, monto) y el cálculo explica la retención", async ({
  page,
  request,
}) => {
  await worldWithPayments(request);
  await openMovements(page);

  const head = page.getByTestId("movements-head");
  await expect(head).toBeVisible();
  // HU-COM-33: an empty cell for the arrow before the date and another one for the ⋮ after the amount.
  await expect(head.locator(":scope > *")).toHaveText(["", /Date/, "Item", "Professional", "Type", "Calculation", "Status", "Amount", ""]);

  const first = rows(page).first(); // the newest: Bea's 200.000 sale
  await expect(first.getByTestId("movement-item")).toHaveText(w.service.name, { ignoreCase: true });
  await expect(first.getByTestId("movement-invoice")).not.toBeEmpty();
  await expect(first.getByTestId("movement-professional")).toHaveText(w.bea.name);
  await expect(first.getByTestId("movement-type")).toHaveText("Commission");
  await expect(first.getByTestId("movement-calc-main")).toHaveText("Service 50 % → 45 %");
  await expect(first.getByTestId("movement-calc-extra")).toHaveText("Retention 5 % · Gs. 10.000");
  await expect(first.getByTestId("movement-status")).toContainText("Unsettled");
  await expect(first.getByTestId("movement-amount")).toHaveText("Gs. 90.000");
  await expect(first.getByTestId("movement-date")).toContainText(/\d{2}\/\d{2}\/\d{4}/);

  // Without retention the calculation says just the %.
  const anas = rows(page).filter({ hasText: w.ana.name });
  await expect(anas.getByTestId("movement-calc-main")).toHaveText("50 %");
  await expect(anas.getByTestId("movement-calc-extra")).toHaveCount(0);

  // The columns line up: the amounts share their right edge and the headers sit over their cells.
  const amounts = await rows(page).getByTestId("movement-amount").evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().right)));
  expect(new Set(amounts).size).toBe(1);
});

// ── AC3 · orden desde la columna FECHA ───────────────────────────────────────────────────────────

test("AC3 · no hay lista «Ordenar»: la columna FECHA ordena (↓ más recientes primero, ↑ más antiguos primero) y vuelve a la primera página", async ({
  page,
  request,
}) => {
  for (let i = 0; i < 12; i++) await sale(request, w.ana.id, 100000 + i * 10000); // 40 % of the price: 40.000 … 84.000
  await openMovements(page);

  await expect(page.getByText("Sort", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: /sort/i })).toHaveCount(0);
  const sort = page.getByTestId("movements-sort");
  await expect(sort).toHaveAttribute("data-order", "desc");
  await expect(sort).toContainText("↓");
  await expect(rows(page).first().getByTestId("movement-amount")).toHaveText("Gs. 84.000");

  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("11–12 of 12")).toBeVisible();
  await sort.click();
  await expect(sort).toHaveAttribute("data-order", "asc");
  await expect(sort).toContainText("↑");
  await expect(page.getByText("1–10 of 12")).toBeVisible();
  await expect(rows(page).first().getByTestId("movement-amount")).toHaveText("Gs. 40.000");

  // It is a button of at least 44 px, with the state said in words for screen readers.
  const box = await sort.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await expect(sort).toHaveAttribute("aria-label", /oldest first/i);
});

// ── AC4 · AC5 · AC6 · filtro de pago ─────────────────────────────────────────────────────────────

test("AC4 · AC5 · el filtro «Pago» (Todas · Sin pagar · Pagadas) muestra la cantidad de cada una y filtra la lista", async ({ page, request }) => {
  await worldWithPayments(request);
  await openMovements(page);

  await expect(page.getByTestId("movements-pay-all")).toHaveText("All · 3");
  await expect(page.getByTestId("movements-pay-unpaid")).toHaveText("Unpaid · 2");
  await expect(page.getByTestId("movements-pay-paid")).toHaveText("Paid · 1");
  await expect(page.getByTestId("movements-pay-all")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("«Unpaid» includes Unsettled, Draft and Approved. To sort, tap DATE.")).toBeVisible();

  await page.getByTestId("movements-pay-paid").click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first().getByTestId("movement-professional")).toHaveText(w.ana.name);
  await expect(rows(page).first().getByTestId("movement-status")).toContainText("Paid");

  // Unpaid joins «Unsettled» and «Draft» (and «Approved»): each row still says which one it is.
  await page.getByTestId("movements-pay-unpaid").click();
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).getByTestId("movement-professional")).toHaveText([w.bea.name, w.bea.name]);
  await expect(rows(page).first().getByTestId("movement-status")).toContainText("Unsettled");
  await expect(rows(page).last().getByTestId("movement-status")).toContainText("Draft");

  await page.getByTestId("movements-pay-all").click();
  await expect(rows(page)).toHaveCount(3);
});

test("AC6 · el filtro «Pago» se combina con la búsqueda y con el orden, y no cambia lo que dicen los contadores de lo ya buscado", async ({
  page,
  request,
}) => {
  await worldWithPayments(request);
  await openMovements(page);

  await page.getByTestId("movements-pay-unpaid").click();
  await page.getByTestId("movements-sort").click(); // oldest first: the draft one, then the not settled one
  await expect(rows(page).first().getByTestId("movement-status")).toContainText("Draft");
  await expect(rows(page).last().getByTestId("movement-status")).toContainText("Unsettled");
  // The search keeps both the filter and the order.
  await page.getByRole("searchbox").fill(w.service.name);
  await page.getByTestId("movements-search").click();
  await expect(page.getByTestId("movements-pay-unpaid")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("movements-sort")).toHaveAttribute("data-order", "asc");
  await expect(rows(page)).toHaveCount(2);
  await page.getByRole("searchbox").fill("sin-coincidencias-xyz");
  await page.getByTestId("movements-search").click();
  await expect(page.getByTestId("movements-pay-all")).toHaveText("All · 0");
  await expect(rows(page)).toHaveCount(0);
});

// ── AC7 · pie con totales ────────────────────────────────────────────────────────────────────────

test("AC7 · el pie suma lo que se ve (total y retenido, de todas las páginas) y se recalcula con el filtro", async ({ page, request }) => {
  await worldWithPayments(request);
  await openMovements(page);

  // 50.000 (Ana) + 45.000 + 90.000 (Bea); retained 5.000 + 10.000.
  await expect(page.getByTestId("movements-total-amount")).toHaveText("Gs. 185.000");
  await expect(page.getByTestId("movements-total-retained")).toHaveText("Gs. 15.000");
  await page.getByTestId("movements-pay-paid").click();
  await expect(page.getByTestId("movements-total-amount")).toHaveText("Gs. 50.000");
  await expect(page.getByTestId("movements-total-retained")).toHaveCount(0); // she retains nothing
  await page.getByTestId("movements-pay-unpaid").click();
  await expect(page.getByTestId("movements-total-amount")).toHaveText("Gs. 135.000");
  await expect(page.getByTestId("movements-total-retained")).toHaveText("Gs. 15.000");
});

// ── AC8 · celular ────────────────────────────────────────────────────────────────────────────────

test("AC8 · en el celular cada movimiento es una tarjeta (sin encabezado de columnas), sin desbordar, con un botón de orden y el filtro de pago", async ({
  page,
  request,
}) => {
  await worldWithPayments(request);
  await openMovements(page);
  await page.setViewportSize({ width: 390, height: 844 });

  await expect(page.getByTestId("movements-head")).toBeHidden();
  await expect(rows(page)).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

  // The card shows the item, the professional, the calculation and the amount.
  const first = rows(page).first();
  await expect(first.getByTestId("movement-item")).toBeVisible();
  await expect(first.getByTestId("movement-professional")).toBeVisible();
  await expect(first.getByTestId("movement-calc-main")).toBeVisible();
  await expect(first.getByTestId("movement-amount")).toBeVisible();

  // The order button replaces the column header, and the payment filter is a row of buttons of at least 44 px.
  const sort = page.getByTestId("movements-sort-mobile");
  await expect(sort).toBeVisible();
  await expect(sort).toContainText("newest first");
  await sort.click();
  await expect(sort).toContainText("oldest first");
  await expect(sort).toHaveAttribute("data-order", "asc");
  const chip = await page.getByTestId("movements-pay-unpaid").boundingBox();
  expect(chip!.height).toBeGreaterThanOrEqual(44);
  await page.getByTestId("movements-pay-paid").click();
  await expect(rows(page)).toHaveCount(1);
});
