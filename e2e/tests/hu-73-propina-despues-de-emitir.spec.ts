import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { API_BASE, apiGetJson, apiPostJson, authHeaders } from "../fixtures/api";
import { clickIssueInvoiceAndExpectSuccess, pickServiceLine } from "../fixtures/invoice";
import {
  issueInvoice,
  loginAdminUi,
  provisionCommissionWorld,
  voidInvoice,
  type CommissionWorld,
} from "../fixtures/commissions";
import {
  goToBillingHome,
  goToInvoiceHistory,
  pickInvoiceLineProfessional,
  searchInvoiceHistory,
} from "../fixtures/billing";

/**
 * HU-73 · Propina después de emitir el comprobante: solapa «Propinas» (plegada y resaltada si está
 * pendiente) en «Comprobante emitido» y en el detalle; cada propina con su forma de pago entra a la
 * caja abierta; solo el administrador anula. Mundo propio por test (tenant nuevo, caja abierta con
 * 50.000, comisiones deshabilitadas).
 */
let w: CommissionWorld;

test.beforeEach(async ({ request }) => {
  w = await provisionCommissionWorld(request, "Propina tardia", { commissionsEnabled: false });
});

type CashDetail = {
  id: number;
  expectedCashAmount: string;
  paymentSummary: { method: string; total: string }[];
  lateTips?: { id: number; voided: boolean; paymentMethod: string; amount: string }[];
};

type TipsResponse = {
  invoiceStatus: string;
  total: number;
  items: { source: string; id: number | null; professionalId: number; amount: number; voided: boolean; paymentMethod: string | null }[];
};

async function cashDetail(request: APIRequestContext): Promise<CashDetail> {
  const current = await apiGetJson<{ id: number }>(request, w.adminToken, "/api/cash-sessions/current");
  return apiGetJson<CashDetail>(request, w.adminToken, `/api/cash-sessions/${current.id}`);
}

const methodTotal = (d: CashDetail, method: string) =>
  Number(d.paymentSummary.find((p) => p.method === method)?.total ?? 0);

const balance = async (request: APIRequestContext, professionalId: number) =>
  Number(
    (
      await apiGetJson<{ balance: number }>(
        request,
        w.adminToken,
        `/api/propinas/balance?professionalId=${professionalId}`,
      )
    ).balance,
  );

const invoiceTips = (request: APIRequestContext, invoiceId: number) =>
  apiGetJson<TipsResponse>(request, w.adminToken, `/api/invoices/${invoiceId}/tips`);

async function addTipApi(
  request: APIRequestContext,
  invoiceId: number,
  tips: { professionalId: number; amount: number; paymentMethod: string; cardBrand?: string }[],
) {
  return apiPostJson<TipsResponse>(request, w.adminToken, `/api/invoices/${invoiceId}/tips`, { tips });
}

async function closeCashApi(request: APIRequestContext) {
  const res = await request.post(`${API_BASE}/api/cash-sessions/close`, {
    headers: authHeaders(w.adminToken),
    data: { countedCashAmount: 0 },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

/** An invoice served by Ana (the line carries her), issued through the API. */
async function invoiceByAna(request: APIRequestContext) {
  return issueInvoice(request, w.adminToken, [
    { serviceId: w.service.id, name: w.service.name, professionalId: w.ana.id },
  ]);
}

/** Issues an invoice through the UI (Ana serves the line) and leaves the page on «Comprobante emitido». */
async function issueThroughUi(page: Page): Promise<{ id: number }> {
  await page.goto("/app/billing");
  await goToBillingHome(page);
  await page.getByRole("button", { name: "New Invoice" }).click();
  await page.getByLabel("Search or select client").click();
  await page.getByRole("button", { name: "Occasional client" }).click();
  await page.getByLabel("Client name / business name").fill("Venta Propina Tardia");
  await pickServiceLine(page, w.service.name, 0);
  await pickInvoiceLineProfessional(page, 0, w.ana.name);
  const inv = await clickIssueInvoiceAndExpectSuccess(page);
  await expect(page.getByTestId("billing-invoice-success")).toBeVisible();
  return inv;
}

async function openDetailFromToday(page: Page, invoiceId: number) {
  await page.goto("/app/billing");
  await goToBillingHome(page);
  await page.getByTestId(`billing-today-row-${invoiceId}`).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

async function openTipsTab(page: Page) {
  const toggle = page.getByTestId("invoice-tips-toggle");
  await expect(toggle).toBeVisible({ timeout: 15_000 });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(page.getByTestId("invoice-tips-body")).toBeVisible();
}

test("AC1-3 · «Comprobante emitido»: la solapa llega plegada y resaltada; las propinas entran a la caja con su forma de pago", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await loginAdminUi(page, w);
  const cashBefore = await cashDetail(request);
  const inv = await issueThroughUi(page);

  // AC1 — collapsed and highlighted as pending.
  const panel = page.getByTestId("invoice-tips");
  await expect(panel).toHaveAttribute("data-state", "pending");
  await expect(page.getByTestId("invoice-tips-toggle")).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("invoice-tips-badge")).toHaveText("Pending");
  await expect(panel.getByText("Did the client leave a tip?")).toBeVisible();
  await expect(page.getByTestId("invoice-tips-body")).toHaveCount(0);

  // AC2 — one row per professional who served, each with amount and payment method.
  await openTipsTab(page);
  const rows = page.getByTestId("invoice-tips-row");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(w.ana.name);
  await rows.first().getByLabel(/Tip amount/).fill("10000");
  await rows.first().getByLabel(/How was it paid/).selectOption("CASH");

  // «+ Another professional»: Bea, paid by debit card (the brand is mandatory).
  await page.getByTestId("invoice-tips-add-other").click();
  const extra = rows.nth(1);
  await extra.locator('select[id$="-prof"]').selectOption({ label: w.bea.name });
  await extra.getByLabel(/Tip amount/).fill("5000");
  await extra.getByLabel(/How was it paid/).selectOption("DEBIT_CARD");
  await page.getByTestId("invoice-tips-submit").click();
  await expect(extra.getByText("Select the card brand.")).toBeVisible();
  await extra.getByLabel("Card brand").selectOption("VISA");
  await expect(page.getByTestId("invoice-tips-entered-total")).toHaveText("15.000");

  await page.getByTestId("invoice-tips-submit").click();

  // The tab now reads «15.000 registered» and the tips are listed read-only (no form).
  await expect(page.getByTestId("invoice-tips-notice")).toContainText("Tips registered in the cash register");
  await expect(panel).toHaveAttribute("data-state", "registered");
  await expect(page.getByTestId("invoice-tips-badge")).toHaveText("15.000 registered");
  await expect(page.getByTestId("invoice-tips-form")).toHaveCount(0);
  await expect(page.getByTestId("invoice-tips-list")).toContainText("Cash");
  await expect(page.getByTestId("invoice-tips-list")).toContainText("Debit card · Visa");

  // AC3 — the cash register: only the cash tip moves the expected cash; both join the method totals.
  const cashAfter = await cashDetail(request);
  expect(Number(cashAfter.expectedCashAmount) - Number(cashBefore.expectedCashAmount)).toBe(
    110000 + 10000,
  );
  expect(methodTotal(cashAfter, "CASH") - methodTotal(cashBefore, "CASH")).toBe(110000 + 10000);
  expect(methodTotal(cashAfter, "DEBIT_CARD") - methodTotal(cashBefore, "DEBIT_CARD")).toBe(5000);
  expect(cashAfter.lateTips?.filter((t) => !t.voided)).toHaveLength(2);
  // The invoice itself is untouched.
  const detail = await apiGetJson<{ total: string; tipsAmount: string; payments: unknown[] }>(
    request,
    w.adminToken,
    `/api/invoices/${inv.id}`,
  );
  expect(Number(detail.total)).toBe(110000);
  expect(detail.payments).toHaveLength(1);
  // The professionals' balances grew.
  expect(await balance(request, w.ana.id)).toBe(10000);
  expect(await balance(request, w.bea.id)).toBe(5000);
});

test("AC3 · la caja muestra las propinas en «Cobros por método» y en «Movimientos»", async ({ page, request }) => {
  test.setTimeout(90_000);
  const inv = await invoiceByAna(request);
  await addTipApi(request, inv.id, [
    { professionalId: w.ana.id, amount: 10000, paymentMethod: "CASH" },
    { professionalId: w.ana.id, amount: 5000, paymentMethod: "DEBIT_CARD", cardBrand: "VISA" },
  ]);

  await loginAdminUi(page, w);
  await page.goto("/app/billing");
  await goToBillingHome(page);
  await page.getByTestId("billing-cash-chip").click();
  const panel = page.getByTestId("billing-cash-panel");
  await panel.getByTestId("cash-section-methods").click();
  await expect(panel.getByTestId("cash-late-tips-note")).toContainText(
    "They include the tips collected after issuing: cash Gs. 10.000, debit card Gs. 5.000.",
  );
  await panel.getByTestId("cash-section-movements").click();
  const tipRows = panel.getByTestId("cash-late-tip-row");
  await expect(tipRows).toHaveCount(2);
  await expect(tipRows.first()).toContainText("Tip collected");
  await expect(tipRows.first()).toContainText(w.ana.name);
  await expect(tipRows.first().getByTestId("cash-late-tip-amount")).toHaveText("+Gs. 10.000");
  await expect(tipRows.nth(1).getByTestId("cash-late-tip-amount")).toHaveText("Gs. 5.000");
});

/** Opens the cash register panel (chip) and returns it; the figures are the ones it shows right now. */
async function openCashPanel(page: Page) {
  await page.getByTestId("billing-cash-chip").click();
  const panel = page.getByTestId("billing-cash-panel");
  await expect(panel).toBeVisible();
  return panel;
}

test("AC3 · la caja se actualiza al instante con la propina registrada desde el detalle del comprobante de hoy", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const inv = await invoiceByAna(request);
  await loginAdminUi(page, w);
  await page.goto("/app/billing");
  await goToBillingHome(page);

  // The register is opened first (its figures get loaded), then closed again.
  const before = Number((await cashDetail(request)).expectedCashAmount);
  let panel = await openCashPanel(page);
  await expect(panel.getByTestId("cash-summary-expected-cash")).toHaveText(new RegExp(`^Gs\\. ${before.toLocaleString("es-PY")}$`));
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);

  // The tip is registered from the invoice detail, which stays open on top of the home.
  await page.getByTestId(`billing-today-row-${inv.id}`).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await openTipsTab(page);
  await page.getByTestId("invoice-tips-open-form").click();
  const row = page.getByTestId("invoice-tips-row").first();
  await row.getByLabel(/Tip amount/).fill("10000");
  await row.getByLabel(/How was it paid/).selectOption("CASH");
  await page.getByTestId("invoice-tips-submit").click();
  await expect(page.getByTestId("invoice-tips-badge")).toHaveText("10.000 registered");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The register shows it right away, without reloading the page or doing anything else.
  panel = await openCashPanel(page);
  await expect(panel.getByTestId("cash-summary-expected-cash")).toHaveText(
    new RegExp(`^Gs\\. ${(before + 10000).toLocaleString("es-PY")}$`),
  );
  await panel.getByTestId("cash-section-movements").click();
  const tipRows = panel.getByTestId("cash-late-tip-row");
  await expect(tipRows).toHaveCount(1);
  await expect(tipRows.first()).toContainText("Tip collected");
  await expect(tipRows.first().getByTestId("cash-late-tip-amount")).toHaveText("+Gs. 10.000");
});

test("AC3 · idem al registrar la propina desde «Comprobante emitido»: al volver al inicio la caja ya la tiene", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await loginAdminUi(page, w);
  await issueThroughUi(page);
  await openTipsTab(page);
  await page.getByTestId("invoice-tips-row").first().getByLabel(/Tip amount/).fill("10000");
  await page.getByTestId("invoice-tips-submit").click();
  await expect(page.getByTestId("invoice-tips-badge")).toHaveText("10.000 registered");

  await page.getByTestId("billing-success-back").click();
  await expect(page.getByTestId("billing-cash-chip")).toBeVisible();
  const expected = Number((await cashDetail(request)).expectedCashAmount);
  const panel = await openCashPanel(page);
  await expect(panel.getByTestId("cash-summary-expected-cash")).toHaveText(new RegExp(`^Gs\\. ${expected.toLocaleString("es-PY")}$`));
  await panel.getByTestId("cash-section-movements").click();
  await expect(panel.getByTestId("cash-late-tip-row")).toHaveCount(1);
});

test("AC9 · la caja también se actualiza al anular la propina desde el detalle", async ({ page, request }) => {
  test.setTimeout(120_000);
  const inv = await invoiceByAna(request);
  await addTipApi(request, inv.id, [{ professionalId: w.ana.id, amount: 10000, paymentMethod: "CASH" }]);
  const tipId = (await invoiceTips(request, inv.id)).items.find((i) => i.source === "LATE")!.id!;
  await loginAdminUi(page, w);
  await page.goto("/app/billing");
  await goToBillingHome(page);

  // The register is loaded with the tip counted…
  let panel = await openCashPanel(page);
  await expect(panel.getByTestId("cash-section-movements")).toContainText("1");
  await page.keyboard.press("Escape");

  // …and voiding it from the detail takes it out right away.
  await page.getByTestId(`billing-today-row-${inv.id}`).click();
  await openTipsTab(page);
  await page.getByTestId(`invoice-tip-void-${tipId}`).click();
  await page.getByTestId("late-tip-void-reason").fill("Monto mal cargado");
  await page.getByTestId("late-tip-void-confirm").click();
  await expect(page.getByTestId(`invoice-tip-${tipId}`)).toContainText("Voided");
  await page.keyboard.press("Escape");

  const expected = Number((await cashDetail(request)).expectedCashAmount);
  panel = await openCashPanel(page);
  await expect(panel.getByTestId("cash-summary-expected-cash")).toHaveText(new RegExp(`^Gs\\. ${expected.toLocaleString("es-PY")}$`));
  await panel.getByTestId("cash-section-movements").click();
  const voidedRow = panel.getByTestId("cash-late-tip-row");
  await expect(voidedRow).toHaveAttribute("data-voided", "true");
});

test("AC4 · sin caja abierta se avisa, el formulario queda deshabilitado y «Ir a Caja» cierra el detalle", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  await invoiceByAna(request);
  await closeCashApi(request);

  await loginAdminUi(page, w);
  await page.goto("/app/billing");
  await goToInvoiceHistory(page);
  await searchInvoiceHistory(page, "Cliente Comisiones E2E");
  await page
    .locator('[data-testid^="invoice-history-row-"]')
    .filter({ visible: true })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();

  await openTipsTab(page);
  await expect(page.getByTestId("invoice-tips-no-cash")).toContainText("No cash register is open");
  await page.getByTestId("invoice-tips-open-form").click();
  await expect(page.getByTestId("invoice-tips-submit")).toBeDisabled();
  await expect(page.getByTestId("invoice-tips-row").first().getByLabel(/Tip amount/)).toBeDisabled();

  await page.getByTestId("invoice-tips-go-cash").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("AC4 · si la caja se cierra con la pantalla ya abierta, el servidor lo rechaza con un mensaje", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await loginAdminUi(page, w);
  await issueThroughUi(page);
  await openTipsTab(page);
  await page.getByTestId("invoice-tips-row").first().getByLabel(/Tip amount/).fill("10000");
  await closeCashApi(request);

  await page.getByTestId("invoice-tips-submit").click();
  await expect(page.getByTestId("invoice-tips-submit-error")).toContainText(
    "No cash register is open: open it to register tips.",
  );
});

test("AC5-7 · el detalle muestra la misma solapa (neutra), se agrega desde ahí y aparece en la pantalla de Propinas", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const inv = await invoiceByAna(request);
  await loginAdminUi(page, w);
  await openDetailFromToday(page, inv.id);

  // AC7 — neutral while there are no tips (never highlighted in the detail).
  const panel = page.getByTestId("invoice-tips");
  await expect(panel).toHaveAttribute("data-state", "none");
  await expect(page.getByTestId("invoice-tips-badge")).toHaveText("No tips");
  await openTipsTab(page);
  await expect(page.getByTestId("invoice-tips-empty")).toContainText("no tips registered");
  await page.getByTestId("invoice-tips-open-form").click();
  const row = page.getByTestId("invoice-tips-row").first();
  await row.getByLabel(/Tip amount/).fill("7000");
  await row.getByLabel(/How was it paid/).selectOption("TRANSFER");
  await page.getByTestId("invoice-tips-submit").click();
  await expect(panel).toHaveAttribute("data-state", "registered");
  await expect(page.getByTestId("invoice-tips-badge")).toHaveText("7.000 registered");

  // AC5 — read-only list with its payment method; more can be added.
  const list = page.getByTestId("invoice-tips-list");
  await expect(list).toContainText(w.ana.name);
  await expect(list).toContainText("Transfer");
  await expect(page.getByTestId("invoice-tips-open-form")).toHaveText("+ Add another tip");
  expect(await balance(request, w.ana.id)).toBe(7000);

  // AC6 — it shows in the Propinas screen with where it comes from.
  await page.keyboard.press("Escape");
  await page.goto("/app/propinas");
  const movement = page
    .getByTestId("propinas-movement")
    .filter({ hasText: /Tip from Cliente Comisiones E2E/ })
    .first();
  await expect(movement).toBeVisible({ timeout: 20_000 });
  await expect(movement).toContainText("7.000");
  const tooltip = (await movement.locator("[title]").first().getAttribute("title")) ?? "";
  expect(tooltip).toContain("Collected after issuing");
  expect(tooltip).toContain("Transfer");
});

test("AC9 · el administrador anula desde el detalle con motivo: queda «Anulada» y deja de contar en la caja y en el acumulado", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const inv = await invoiceByAna(request);
  const cashBefore = await cashDetail(request);
  await addTipApi(request, inv.id, [{ professionalId: w.ana.id, amount: 10000, paymentMethod: "CASH" }]);
  expect(await balance(request, w.ana.id)).toBe(10000);
  expect(Number((await cashDetail(request)).expectedCashAmount) - Number(cashBefore.expectedCashAmount)).toBe(10000);
  const tipId = (await invoiceTips(request, inv.id)).items.find((i) => i.source === "LATE")!.id!;

  await loginAdminUi(page, w);
  await openDetailFromToday(page, inv.id);
  await openTipsTab(page);
  await page.getByTestId(`invoice-tip-void-${tipId}`).click();
  await expect(page.getByTestId("late-tip-void-dialog")).toBeVisible();

  // The reason is mandatory.
  await page.getByTestId("late-tip-void-confirm").click();
  await expect(page.getByText("Enter the reason for voiding.")).toBeVisible();
  await page.getByTestId("late-tip-void-reason").fill("Monto mal cargado");
  await page.getByTestId("late-tip-void-confirm").click();

  await expect(page.getByTestId("late-tip-void-dialog")).toHaveCount(0);
  const tip = page.getByTestId(`invoice-tip-${tipId}`);
  await expect(tip).toContainText("Voided");
  await expect(tip).toContainText("«Monto mal cargado»");
  await expect(page.getByTestId("invoice-tips-notice")).toContainText("Tip voided");
  await expect(page.getByTestId(`invoice-tip-void-${tipId}`)).toHaveCount(0);
  await expect(page.getByTestId("invoice-tips")).toHaveAttribute("data-state", "none");

  // It stops counting in the professional's balance and in the cash register, but stays listed.
  expect(await balance(request, w.ana.id)).toBe(0);
  const cashAfter = await cashDetail(request);
  expect(Number(cashAfter.expectedCashAmount)).toBe(Number(cashBefore.expectedCashAmount));
  expect(cashAfter.lateTips?.find((t) => t.id === tipId)?.voided).toBe(true);
});

test("AC9 · también se anula desde la pantalla de Propinas (solo «Anular», sin «Editar»)", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const inv = await invoiceByAna(request);
  await addTipApi(request, inv.id, [{ professionalId: w.ana.id, amount: 10000, paymentMethod: "CASH" }]);

  await loginAdminUi(page, w);
  await page.goto("/app/propinas");
  const row = page
    .getByTestId("propinas-movement")
    .filter({ hasText: /Tip from Cliente Comisiones E2E/ })
    .first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.getByRole("button").click();
  await expect(page.getByRole("menuitem", { name: "Void" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Edit" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Void" }).click();
  await page.getByTestId("late-tip-void-reason").fill("Error de carga");
  await page.getByTestId("late-tip-void-confirm").click();

  await expect(page.getByTestId("propinas-toast")).toContainText("Tip voided");
  const voidedRow = page.getByTestId("propinas-movement").filter({ hasText: /Tip from Cliente Comisiones E2E/ }).first();
  await expect(voidedRow).toHaveAttribute("data-voided", "true");
  await expect(voidedRow.getByTestId("propinas-voided-tag")).toBeVisible();
  await expect(voidedRow.getByRole("button")).toHaveCount(0);
  expect(await balance(request, w.ana.id)).toBe(0);
});

test("AC10 · no se puede anular si la profesional ya retiró ese dinero", async ({ page, request }) => {
  test.setTimeout(120_000);
  const inv = await invoiceByAna(request);
  await addTipApi(request, inv.id, [{ professionalId: w.ana.id, amount: 10000, paymentMethod: "CASH" }]);
  await apiPostJson(request, w.adminToken, "/api/propinas/withdrawals", {
    professionalId: w.ana.id,
    amount: 10000,
  });
  const tipId = (await invoiceTips(request, inv.id)).items.find((i) => i.source === "LATE")!.id!;

  await loginAdminUi(page, w);
  await openDetailFromToday(page, inv.id);
  await openTipsTab(page);
  await page.getByTestId(`invoice-tip-void-${tipId}`).click();
  await page.getByTestId("late-tip-void-reason").fill("Error");
  await page.getByTestId("late-tip-void-confirm").click();
  await expect(page.getByTestId("late-tip-void-error")).toContainText("already withdrawn this money");
  await expect(page.getByTestId("late-tip-void-dialog")).toBeVisible();
  expect(await balance(request, w.ana.id)).toBe(0);
  const state = await invoiceTips(request, inv.id);
  expect(state.items.find((i) => i.id === tipId)?.voided).toBe(false);
});

test("AC10 · con la caja ya cerrada no se ofrece «Anular» y el servidor también lo rechaza", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const inv = await invoiceByAna(request);
  await addTipApi(request, inv.id, [{ professionalId: w.ana.id, amount: 10000, paymentMethod: "CASH" }]);
  const tipId = (await invoiceTips(request, inv.id)).items.find((i) => i.source === "LATE")!.id!;
  await closeCashApi(request);

  const res = await request.post(`${API_BASE}/api/propinas/late/${tipId}/void`, {
    headers: authHeaders(w.adminToken),
    data: { reason: "Tarde" },
  });
  expect(res.status()).toBe(409);
  expect(await res.text()).toContain("LATE_TIP_CASH_SESSION_CLOSED");

  await loginAdminUi(page, w);
  await page.goto("/app/billing");
  await goToInvoiceHistory(page);
  await searchInvoiceHistory(page, "Cliente Comisiones E2E");
  await page.locator('[data-testid^="invoice-history-row-"]').filter({ visible: true }).first().click();
  await openTipsTab(page);
  await expect(page.getByTestId(`invoice-tip-${tipId}`)).toBeVisible();
  await expect(page.getByTestId(`invoice-tip-void-${tipId}`)).toHaveCount(0);
});

test("AC1 · un comprobante anulado no muestra la solapa y el servidor no acepta propinas", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const inv = await invoiceByAna(request);
  await voidInvoice(request, w.adminToken, inv.id);

  const res = await request.post(`${API_BASE}/api/invoices/${inv.id}/tips`, {
    headers: authHeaders(w.adminToken),
    data: { tips: [{ professionalId: w.ana.id, amount: 1000, paymentMethod: "CASH" }] },
  });
  expect(res.status()).toBe(409);
  expect(await res.text()).toContain("LATE_TIP_INVOICE_NOT_ISSUED");

  await loginAdminUi(page, w);
  await page.goto("/app/billing");
  await goToInvoiceHistory(page);
  await searchInvoiceHistory(page, "Cliente Comisiones E2E");
  await page.locator('[data-testid^="invoice-history-row-"]').filter({ visible: true }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByTestId("invoice-detail-view")).toBeVisible();
  await expect(page.getByTestId("invoice-tips")).toHaveCount(0);
});

test("la propina cargada después no cambia la factura (totales, pagos, estado)", async ({ request }) => {
  const inv = await invoiceByAna(request);
  const before = await apiGetJson<Record<string, unknown>>(request, w.adminToken, `/api/invoices/${inv.id}`);
  await addTipApi(request, inv.id, [{ professionalId: w.ana.id, amount: 3000, paymentMethod: "CASH" }]);
  const after = await apiGetJson<Record<string, unknown>>(request, w.adminToken, `/api/invoices/${inv.id}`);
  for (const key of ["total", "subtotal", "status", "payments", "tipsAmount"]) {
    expect(after[key], key).toEqual(before[key]);
  }
});
