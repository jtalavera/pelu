import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import {
  apiPostJson,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
  type SeededSalon,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { setControlledInputValue } from "../fixtures/ui";
import { openNewFichaDialog } from "../fixtures/fichas";
import {
  filterPropinasByProfessional,
  openWithdrawDialog,
  expectBalance,
  propinasMovements,
} from "../fixtures/propinas";

test.describe.configure({ mode: "serial" });

type ServiceRecordSeed = { id: number; status: string };

/**
 * Creates an open ficha de servicio with a tip for one professional, then issues an invoice
 * referencing it so the ficha auto-closes — Propinas only reports/accumulates CLOSED-record tips.
 */
async function seedClosedTip(
  request: APIRequestContext,
  token: string,
  params: {
    clientId: number;
    serviceId: number;
    professionalId: number;
    unitPrice: number;
    tipAmount: number;
  },
): Promise<{ recordId: number; invoiceId: number }> {
  const record = await apiPostJson<ServiceRecordSeed>(request, token, "/api/service-records", {
    clientId: params.clientId,
    lines: [
      {
        serviceId: params.serviceId,
        professionalId: params.professionalId,
        quantity: 1,
        unitPrice: params.unitPrice,
      },
    ],
    tips: [{ professionalId: params.professionalId, amount: params.tipAmount }],
  });
  const invoice = await apiPostJson<{ id: number }>(request, token, "/api/invoices", {
    clientId: params.clientId,
    clientDisplayName: null,
    clientRucOverride: null,
    discountType: null,
    discountValue: null,
    lines: [
      {
        serviceId: params.serviceId,
        description: "E2E service",
        quantity: 1,
        unitPrice: params.unitPrice,
        discountType: null,
        discountValue: null,
      },
    ],
    payments: [{ method: "CASH", amount: params.unitPrice }],
    serviceRecordId: record.id,
    tipsAmount: params.tipAmount,
  });
  return { recordId: record.id, invoiceId: invoice.id };
}

test.describe("Issue #133 · Ajustes varios", () => {
  let seed: SeededSalon;

  test.beforeEach(async ({ request }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    seed = await seedCategoryServiceProfessional(request, token);
  });

  test("1 · el formulario de nueva ficha arranca con una sola línea de servicio, vacía", async ({
    page,
  }) => {
    await loginAsDemo(page);
    const dlg = await openNewFichaDialog(page);

    // Redesign: the dialog opens with exactly one blank line (ignored on save if left empty)
    // plus the "Add service" action for more.
    await expect(page.locator('[id^="service-record-line-svc-"]')).toHaveCount(1);
    await expect(page.locator("#service-record-line-svc-0")).toHaveValue("");
    await expect(dlg.getByTestId("service-record-add-line")).toBeVisible();

    // "Add service" adds one more line, on demand.
    await dlg.getByTestId("service-record-add-line").click();
    await expect(dlg.getByTestId("service-record-line")).toHaveCount(2);
  });

  test("2 · los retiros de propina aparecen como movimientos y suman al total retirado del período", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const client = await seedClient(request, token, `E2E133 Withdraw ${Date.now()}`);
    await seedClosedTip(request, token, {
      clientId: client.id,
      serviceId: seed.serviceId,
      professionalId: seed.professionalId,
      unitPrice: 55000,
      tipAmount: 10000,
    });

    await loginAsDemo(page);
    await page.goto("/app/propinas");
    await filterPropinasByProfessional(page, seed.professionalFullName);

    // Before any withdrawal: no withdrawal movement, the generated tip is the whole total.
    await expect(propinasMovements(page).filter({ hasText: client.fullName })).toHaveCount(1, {
      timeout: 15_000,
    });
    await expect(propinasMovements(page).filter({ hasText: "Withdrawal" })).toHaveCount(0);
    await expect(page.getByTestId("propinas-tips-total")).toHaveText("Gs. 10.000");

    // Withdraw part of the balance.
    await expectBalance(page, seed.professionalId, "Gs. 10.000");
    await openWithdrawDialog(page, seed.professionalId);
    const amountInput = page.locator("#propinas-withdrawal-amount");
    await setControlledInputValue(amountInput, "3000");
    await expect(amountInput).toHaveValue("3.000");
    await page.getByTestId("propinas-withdraw-confirm").click();
    await expect(page.getByTestId("propinas-toast")).toContainText(
      "Withdrawal completed successfully.",
      { timeout: 15_000 },
    );

    // A "Withdrawal" movement (minus sign) shows the withdrawn amount; totals follow.
    const withdrawal = propinasMovements(page).filter({ hasText: "Withdrawal" });
    await expect(withdrawal).toHaveCount(1, { timeout: 15_000 });
    await expect(withdrawal).toContainText("Gs. 3.000");
    await expect(page.getByTestId("propinas-withdrawn-total")).toHaveText("Gs. 3.000");
    await expect(page.getByTestId("propinas-tips-total")).toHaveText("Gs. 10.000");
    await expectBalance(page, seed.professionalId, "Gs. 7.000");
  });
});
