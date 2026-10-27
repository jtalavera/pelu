import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { API_BASE, apiGetJson, apiPostJson, authHeaders, seedClient } from "../fixtures/api";
import { clickIssueInvoiceAndExpectSuccess, pickServiceLine } from "../fixtures/invoice";
import {
  issueInvoice,
  loginAdminUi,
  provisionCommissionWorld,
  voidInvoice,
  type CommissionWorld,
} from "../fixtures/commissions";

/**
 * Subsección "Propinas" del formulario de comprobante (debajo de "Métodos de pago"): igual que en
 * la ficha de servicio, una propina por profesional que atendió los servicios; nunca suma al total
 * de la factura, pero la suma se muestra en rojo. Mundo propio, con el módulo de comisiones
 * deshabilitado (el profesional por línea se puede elegir igual, para poder darle propina).
 */
let w: CommissionWorld;

test.beforeEach(async ({ request }) => {
  w = await provisionCommissionWorld(request, "Propinas comprobante", { commissionsEnabled: false });
});

async function openNewInvoice(page: Page) {
  await page.goto("/app/billing");
  await page.getByRole("tab", { name: "Cash Register" }).click();
  await page.getByRole("button", { name: "New Invoice" }).click();
  await page.getByLabel("Search or select client").click();
  await page.getByRole("button", { name: "Occasional client" }).click();
  await page.getByLabel("Client name / business name").fill("Venta Propinas");
}

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

test("propinas por profesional que atendió: debajo de Métodos de pago, total en rojo y fuera del total de la factura", async ({
  page,
  request,
}) => {
  await loginAdminUi(page, w);
  await openNewInvoice(page);

  // The section sits right below "Payment methods" and starts empty (no professional yet).
  const tipsSection = page.getByTestId("billing-tips-section");
  await expect(tipsSection.getByRole("heading", { name: "Tips" })).toBeVisible();
  const paymentsBox = await page.getByRole("heading", { name: "Payment methods" }).boundingBox();
  const tipsBox = await tipsSection.boundingBox();
  expect(tipsBox!.y).toBeGreaterThan(paymentsBox!.y);
  await expect(page.getByTestId("billing-tips-empty")).toBeVisible();

  await pickServiceLine(page, w.service.name, 0);
  // Without the commissions module the professional is still selectable, with no commission hint.
  await page.locator("#line-professional-0").selectOption({ label: w.ana.name });
  await expect(page.getByTestId("line-no-commission-0")).toHaveCount(0);
  await page.getByRole("button", { name: "Add item" }).click();
  await pickServiceLine(page, w.service2.name, 1);
  await page.locator("#line-professional-1").selectOption({ label: w.bea.name });
  // A product line's seller does not get a tip row.
  await page.getByRole("button", { name: "Add item" }).click();
  await pickServiceLine(page, w.product.name, 2);
  await page.locator("#line-professional-2").selectOption({ label: w.ana.name });

  await expect(page.getByTestId("billing-tips-empty")).toHaveCount(0);
  await expect(tipsSection.locator('input[id^="billing-tip-"]')).toHaveCount(2);
  await page.locator(`#billing-tip-${w.ana.id}`).fill("5000");
  await expect(page.locator(`#billing-tip-${w.ana.id}`)).toHaveValue("5.000");
  await page.locator(`#billing-tip-${w.bea.id}`).fill("3000");

  // The sum of tips is shown in red, in the section and in the summary — never in the total.
  await expect(page.getByTestId("billing-tips-total")).toHaveText("8.000");
  await expect(page.getByTestId("billing-tips-total").locator("xpath=..")).toHaveClass(/text-danger/);
  await expect(page.locator("#billing-tips-amount")).toHaveText("8.000");
  await expect(page.locator("#billing-tips-amount")).toHaveClass(/text-danger/);
  await expect(page.getByText("Tip (non-invoiceable)", { exact: true })).toHaveClass(/text-danger/);
  await expect(page.locator("#pay-amount-0")).toHaveValue("330.000");

  const inv = await clickIssueInvoiceAndExpectSuccess(page);
  const issued = await apiGetJson<{ total: number; tipsAmount: number }>(
    request,
    w.adminToken,
    `/api/invoices/${inv.id}`,
  );
  expect(Number(issued.total)).toBe(330000);
  expect(Number(issued.tipsAmount)).toBe(8000);

  // The tips count for each professional in Propinas (balance and report).
  expect(await balance(request, w.ana.id)).toBe(5000);
  expect(await balance(request, w.bea.id)).toBe(3000);
  const report = await apiGetJson<{ rows: { professionalId: number; amount: number; clientName: string }[] }>(
    request,
    w.adminToken,
    "/api/propinas/report",
  );
  const anaRow = report.rows.find((r) => r.professionalId === w.ana.id)!;
  expect(Number(anaRow.amount)).toBe(5000);
  expect(anaRow.clientName.toUpperCase()).toContain("VENTA PROPINAS");

  // Voiding the invoice takes its tips out of the professionals' balance.
  await voidInvoice(request, w.adminToken, inv.id);
  expect(await balance(request, w.ana.id)).toBe(0);
});

test("desde una ficha: las propinas se precargan, se pueden corregir y reemplazan a las de la ficha sin duplicarse", async ({
  page,
  request,
}) => {
  const client = await seedClient(request, w.adminToken, `Cliente Propina ${Date.now()}`);
  const record = await apiPostJson<{ id: number }>(request, w.adminToken, "/api/service-records", {
    clientId: client.id,
    lines: [{ serviceId: w.service.id, professionalId: w.ana.id, quantity: 1, unitPrice: 110000 }],
    tips: [{ professionalId: w.ana.id, amount: 4000 }],
  });

  await loginAdminUi(page, w);
  await page.goto("/app/service-records");
  await page.getByRole("tab", { name: "History" }).click();
  await page.locator("#service-record-history-text-filter").fill("Cliente Propina");
  await page.locator("tbody tr").filter({ hasText: "CLIENTE PROPINA" }).first().click();
  await page.getByRole("button", { name: "Generate invoice" }).click();
  await expect(page).toHaveURL(/\/app\/billing/);

  await expect(page.locator(`#billing-tip-${w.ana.id}`)).toHaveValue("4.000");
  await expect(page.locator("#billing-tips-amount")).toHaveText("4.000");
  await page.locator(`#billing-tip-${w.ana.id}`).fill("6000");
  await expect(page.locator("#billing-tips-amount")).toHaveText("6.000");
  await expect(page.locator("#pay-amount-0")).toHaveValue("110.000");
  await clickIssueInvoiceAndExpectSuccess(page);

  const closed = await apiGetJson<{ status: string; tips: { professionalId: number; amount: number }[] }>(
    request,
    w.adminToken,
    `/api/service-records/${record.id}`,
  );
  expect(closed.status).toBe("CLOSED");
  expect(closed.tips).toHaveLength(1);
  expect(Number(closed.tips[0].amount)).toBe(6000);
  expect(await balance(request, w.ana.id)).toBe(6000);
});

test("API: solo se aceptan propinas para profesionales asignados a un ítem del comprobante", async ({ request }) => {
  const body = (tips: object[]) => ({
    clientId: null,
    clientDisplayName: "Venta API",
    clientRucOverride: null,
    discountType: "NONE",
    discountValue: null,
    lines: [
      {
        serviceId: w.service.id,
        description: w.service.name,
        quantity: 1,
        unitPrice: 110000,
        discountType: null,
        discountValue: null,
        professionalId: w.ana.id,
      },
    ],
    payments: [{ method: "CASH", amount: 110000, cardBrand: null, cardBrandOtherDescription: null }],
    tips,
  });
  const res = await request.post(`${API_BASE}/api/invoices`, {
    headers: authHeaders(w.adminToken),
    data: body([{ professionalId: w.bea.id, amount: 2000 }]),
  });
  expect(res.status()).toBe(400);
  expect(await res.text()).toContain("INVOICE_TIP_PROFESSIONAL_NOT_IN_LINES");
  expect(await balance(request, w.bea.id)).toBe(0);

  // Invoices issued without tips keep working as before.
  await issueInvoice(request, w.adminToken, [{ serviceId: w.service.id, name: w.service.name }]);
  expect(await balance(request, w.ana.id)).toBe(0);
});
