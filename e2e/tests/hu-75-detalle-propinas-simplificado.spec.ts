import { expect, test, type APIRequestContext } from "@playwright/test";
import { API_BASE, apiGetJson, apiPostJson, authHeaders } from "../fixtures/api";
import { issueInvoice, loginAdminUi, provisionCommissionWorld, type CommissionWorld } from "../fixtures/commissions";
import { goToBillingHome } from "../fixtures/billing";

/**
 * HU-75 · Detalle del comprobante: propinas simplificadas y carga en un solo tiempo. El detalle y la
 * solapa «Propinas» se piden a la vez y aparecen juntos (con un esqueleto mientras tanto); la solapa
 * pierde el texto explicativo, el total en rojo, los correos y el motivo de las anuladas.
 */
let w: CommissionWorld;

test.beforeEach(async ({ request }) => {
  w = await provisionCommissionWorld(request, "Detalle propinas", { commissionsEnabled: false });
});

type TipsResponse = {
  items: { source: string; id: number | null; amount: number; voided: boolean }[];
};

async function invoiceByAna(request: APIRequestContext) {
  return issueInvoice(request, w.adminToken, [{ serviceId: w.service.id, name: w.service.name, professionalId: w.ana.id }]);
}

async function addTips(
  request: APIRequestContext,
  invoiceId: number,
  tips: { professionalId: number; amount: number; paymentMethod: string; cardBrand?: string }[],
) {
  return apiPostJson<TipsResponse>(request, w.adminToken, `/api/invoices/${invoiceId}/tips`, { tips });
}

async function voidTip(request: APIRequestContext, tipId: number, reason: string) {
  const res = await request.post(`${API_BASE}/api/propinas/late/${tipId}/void`, {
    headers: authHeaders(w.adminToken),
    data: { reason },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

async function openToday(page: import("@playwright/test").Page, invoiceId: number) {
  await loginAdminUi(page, w);
  await page.goto("/app/billing");
  await goToBillingHome(page);
  await expect(page.getByTestId(`billing-today-row-${invoiceId}`)).toBeVisible({ timeout: 30_000 });
}

test("AC1 · el detalle y la solapa de Propinas aparecen juntos: mientras llegan las propinas se ve un esqueleto", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const inv = await invoiceByAna(request);
  await addTips(request, inv.id, [{ professionalId: w.ana.id, amount: 10000, paymentMethod: "CASH" }]);
  await openToday(page, inv.id);

  // Hold only the tips: the invoice itself answers right away.
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/invoices/${inv.id}/tips`, async (route) => {
    await gate;
    await route.continue();
  });

  await page.getByTestId(`billing-today-row-${inv.id}`).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("invoice-detail-skeleton")).toBeVisible();
  // Not in two steps: nothing of the detail shows before the tips are there.
  await page.waitForTimeout(1500);
  await expect(dialog.getByText(/Cliente Comisiones E2E/i)).toHaveCount(0);
  await expect(dialog.getByTestId("invoice-tips")).toHaveCount(0);
  await expect(dialog.getByTestId("invoice-detail-skeleton")).toBeVisible();

  release();
  await expect(dialog.getByTestId("invoice-detail-skeleton")).toHaveCount(0);
  await expect(dialog.getByText(/Cliente Comisiones E2E/i)).toBeVisible();
  await expect(dialog.getByTestId("invoice-tips")).toBeVisible();
  await expect(dialog.getByTestId("invoice-tips-badge")).toHaveText("10.000 registered");
});

test("AC1 · si las propinas fallan el detalle se muestra igual, sin la solapa", async ({ page, request }) => {
  test.setTimeout(90_000);
  const inv = await invoiceByAna(request);
  await openToday(page, inv.id);
  await page.route(`**/api/invoices/${inv.id}/tips`, (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"BOOM"}' }),
  );

  await page.getByTestId(`billing-today-row-${inv.id}`).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/Cliente Comisiones E2E/i)).toBeVisible({ timeout: 20_000 });
  await expect(dialog.getByTestId("invoice-detail-skeleton")).toHaveCount(0);
  await expect(dialog.getByTestId("invoice-tips")).toHaveCount(0);
});

test("AC2-3 · las propinas se ven sin texto explicativo, sin total en rojo, sin correos y las anuladas solo dicen «Voided»", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const inv = await invoiceByAna(request);
  const saved = await addTips(request, inv.id, [
    { professionalId: w.ana.id, amount: 10000, paymentMethod: "CASH" },
    { professionalId: w.ana.id, amount: 5000, paymentMethod: "DEBIT_CARD", cardBrand: "VISA" },
  ]);
  const cashTip = saved.items.find((i) => i.source === "LATE" && i.amount === 10000)!;
  const cardTip = saved.items.find((i) => i.source === "LATE" && i.amount === 5000)!;
  await voidTip(request, cashTip.id!, "Monto mal cargado");

  await openToday(page, inv.id);
  await page.getByTestId(`billing-today-row-${inv.id}`).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("invoice-tips")).toBeVisible({ timeout: 20_000 });
  await dialog.getByTestId("invoice-tips-toggle").click();
  const body = dialog.getByTestId("invoice-tips-body");
  await expect(body).toBeVisible();

  // No explanatory text and no red total: the total is the badge of the tab.
  await expect(body).not.toContainText("One per professional");
  await expect(body).not.toContainText("not billable");
  await expect(dialog.getByTestId("invoice-tips-total")).toHaveCount(0);
  await expect(dialog.getByTestId("invoice-tips-badge")).toHaveText("5.000 registered");

  // Rows: «how it was paid · time» only; nobody's e-mail.
  const live = dialog.getByTestId(`invoice-tip-${cardTip.id}`);
  await expect(live).toContainText("Debit card · Visa");
  await expect(live).not.toContainText("@");
  // The voided one is struck and tagged, without who voided it or why.
  const voided = dialog.getByTestId(`invoice-tip-${cashTip.id}`);
  await expect(voided).toContainText("Voided");
  await expect(voided).not.toContainText("@");
  await expect(voided).not.toContainText("Monto mal cargado");
  await expect(voided.getByTestId(`invoice-tip-void-${cashTip.id}`)).toHaveCount(0);

  // «Void» is plain red text, still a 44 px target.
  const voidButton = dialog.getByTestId(`invoice-tip-void-${cardTip.id}`);
  await expect(voidButton).toBeVisible();
  const box = (await voidButton.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  await expect(voidButton).toHaveCSS("border-top-width", "0px");
});

test("AC4 · el formulario pone monto y forma de pago en una fila, trae «Cancelar» y el total en el botón", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const inv = await invoiceByAna(request);
  await addTips(request, inv.id, [{ professionalId: w.ana.id, amount: 10000, paymentMethod: "CASH" }]);
  await openToday(page, inv.id);
  await page.getByTestId(`billing-today-row-${inv.id}`).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByTestId("invoice-tips-toggle").click({ timeout: 20_000 });
  await dialog.getByTestId("invoice-tips-open-form").click();

  const form = dialog.getByTestId("invoice-tips-form");
  await expect(form).toBeVisible();
  const row = form.getByTestId("invoice-tips-row").first();
  const amount = row.getByLabel(/Tip amount/);
  const method = row.getByLabel(/How was it paid/);
  const a = (await amount.boundingBox())!;
  const m = (await method.boundingBox())!;
  expect(Math.abs(a.y - m.y)).toBeLessThan(4);

  // One short line instead of the long explanation about the register.
  await expect(form.getByTestId("invoice-tips-cash-note")).toHaveText("Added to the open cash register.");
  await amount.fill("5000");
  await expect(form.getByTestId("invoice-tips-submit")).toHaveText("Register · 5.000");

  // «Cancel» closes the form and nothing is registered.
  await form.getByTestId("invoice-tips-cancel").click();
  await expect(dialog.getByTestId("invoice-tips-form")).toHaveCount(0);
  const tips = await apiGetJson<TipsResponse>(request, w.adminToken, `/api/invoices/${inv.id}/tips`);
  expect(tips.items.filter((i) => i.source === "LATE")).toHaveLength(1);
});
