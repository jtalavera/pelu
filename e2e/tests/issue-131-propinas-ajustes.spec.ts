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
import {
  filterPropinasByProfessional,
  openWithdrawDialog,
  expectBalance,
  propinasMovements,
} from "../fixtures/propinas";

test.describe.configure({ mode: "serial" });

type ServiceRecordSeed = { id: number; status: string };

async function seedProfessional(
  request: APIRequestContext,
  token: string,
  fullName: string,
): Promise<{ id: number; fullName: string }> {
  // Names are stored in UPPERCASE (issue #155 AC3) — return what's actually displayed,
  // not the mixed-case string sent above.
  return apiPostJson<{ id: number; fullName: string }>(request, token, "/api/professionals", {
    fullName,
    phone: null,
    email: null,
    photoDataUrl: null,
  });
}

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

test.describe("Issue #131 · Ajustes en propinas", () => {
  let seed: SeededSalon;

  test.beforeEach(async ({ request }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    seed = await seedCategoryServiceProfessional(request, token);
  });

  test("AC1 · Limpiar desmarca las profesionales y recarga el reporte con todas", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const clientA = await seedClient(request, token, `E2E Clear A ${Date.now()}`);
    const clientB = await seedClient(request, token, `E2E Clear B ${Date.now()}`);
    const profB = await seedProfessional(request, token, `E2E ClearB ${Date.now()}`);

    await seedClosedTip(request, token, {
      clientId: clientA.id,
      serviceId: seed.serviceId,
      professionalId: seed.professionalId,
      unitPrice: 50000,
      tipAmount: 5000,
    });
    await seedClosedTip(request, token, {
      clientId: clientB.id,
      serviceId: seed.serviceId,
      professionalId: profB.id,
      unitPrice: 60000,
      tipAmount: 3000,
    });

    await loginAsDemo(page);
    await page.goto("/app/propinas");

    // Restrict to a single professional first, so both rows aren't already visible.
    await filterPropinasByProfessional(page, seed.professionalFullName);
    await expect(propinasMovements(page).filter({ hasText: clientA.fullName })).toHaveCount(1, {
      timeout: 15_000,
    });
    await expect(propinasMovements(page).filter({ hasText: clientB.fullName })).toHaveCount(0);

    // AC1: picking "All" clears the professional filter and reloads with every professional,
    // with no extra click needed.
    await page.locator("#propinas-filter-professional").selectOption("");
    await expect(propinasMovements(page).filter({ hasText: clientA.fullName })).toHaveCount(1, {
      timeout: 15_000,
    });
    await expect(propinasMovements(page).filter({ hasText: clientB.fullName })).toHaveCount(1);
    await expect(page.locator("#propinas-filter-professional")).toHaveValue("");
  });

  test("AC2 · el reporte omite los registros de propina con monto cero", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const clientZero = await seedClient(request, token, `E2E ZeroTip ${Date.now()}`);
    const clientNonZero = await seedClient(request, token, `E2E NonZeroTip ${Date.now()}`);

    await seedClosedTip(request, token, {
      clientId: clientZero.id,
      serviceId: seed.serviceId,
      professionalId: seed.professionalId,
      unitPrice: 40000,
      tipAmount: 0,
    });
    await seedClosedTip(request, token, {
      clientId: clientNonZero.id,
      serviceId: seed.serviceId,
      professionalId: seed.professionalId,
      unitPrice: 40000,
      tipAmount: 2000,
    });

    await loginAsDemo(page);
    await page.goto("/app/propinas");
    await filterPropinasByProfessional(page, seed.professionalFullName);

    await expect(propinasMovements(page).filter({ hasText: clientNonZero.fullName })).toHaveCount(1, {
      timeout: 15_000,
    });
    await expect(propinasMovements(page).filter({ hasText: clientZero.fullName })).toHaveCount(0);
    // The period total only reflects the non-zero tip.
    await expect(page.getByTestId("propinas-tips-total")).toHaveText("Gs. 2.000");
  });

  test("AC3 · un retiro de propina se refleja en los totales de movimientos", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const client = await seedClient(request, token, `E2E WithdrawReport ${Date.now()}`);
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
    await expect(page.getByTestId("propinas-tips-total")).toHaveText("Gs. 10.000", { timeout: 15_000 });
    await expect(page.getByTestId("propinas-withdrawn-total")).toHaveText("Gs. 0");

    // Withdraw part of the balance from the balances card.
    await expectBalance(page, seed.professionalId, "Gs. 10.000");
    await openWithdrawDialog(page, seed.professionalId);
    const amountInput = page.locator("#propinas-withdrawal-amount");
    await setControlledInputValue(amountInput, "1000");
    await expect(amountInput).toHaveValue("1.000");
    await page.getByTestId("propinas-withdraw-confirm").click();
    await expect(page.getByTestId("propinas-toast")).toContainText(
      "Withdrawal completed successfully.",
      { timeout: 15_000 },
    );
    await expectBalance(page, seed.professionalId, "Gs. 9.000");

    // AC3: the movements summary (no manual refresh) shows the withdrawal.
    await expect(page.getByTestId("propinas-withdrawn-total")).toHaveText("Gs. 1.000", {
      timeout: 15_000,
    });
    await expect(page.getByTestId("propinas-tips-total")).toHaveText("Gs. 10.000");
  });
});
