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

test.describe("Issue #137 · Ajustes varios v3", () => {
  let seed: SeededSalon;

  test.beforeEach(async ({ request }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    seed = await seedCategoryServiceProfessional(request, token);
  });

  test("1+2+3 · los movimientos de cada profesional incluyen sus propinas y su retiro, con moneda", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const ts = Date.now();
    // "AAA"/"ZZZ" prefixes pin alphabetical order (backend sorts groups by fullName ASC) so the
    // table's row order is deterministic and matches the issue's worked example.
    const profA = await seedProfessional(request, token, `E2E137 AAA Monica ${ts}`);
    const profB = await seedProfessional(request, token, `E2E137 ZZZ Jorgelina ${ts}`);

    const clientA1 = await seedClient(request, token, `E2E137 ClientA1 ${ts}`);
    const clientA2 = await seedClient(request, token, `E2E137 ClientA2 ${ts}`);
    await seedClosedTip(request, token, {
      clientId: clientA1.id,
      serviceId: seed.serviceId,
      professionalId: profA.id,
      unitPrice: 40000,
      tipAmount: 1000,
    });
    await seedClosedTip(request, token, {
      clientId: clientA2.id,
      serviceId: seed.serviceId,
      professionalId: profA.id,
      unitPrice: 40000,
      tipAmount: 1000,
    });
    const clientB = await seedClient(request, token, `E2E137 ClientB ${ts}`);
    await seedClosedTip(request, token, {
      clientId: clientB.id,
      serviceId: seed.serviceId,
      professionalId: profB.id,
      unitPrice: 60000,
      tipAmount: 10000,
    });

    await loginAsDemo(page);
    await page.goto("/app/propinas");

    // Withdraw from each professional's balance (card, paged by balance).
    await expectBalance(page, profA.id, "Gs. 2.000");
    await openWithdrawDialog(page, profA.id);
    await setControlledInputValue(page.locator("#propinas-withdrawal-amount"), "1000");
    await page.getByTestId("propinas-withdraw-confirm").click();
    await expect(page.getByTestId("propinas-toast")).toContainText(
      "Withdrawal completed successfully.",
      { timeout: 15_000 },
    );

    await expectBalance(page, profB.id, "Gs. 10.000");
    await openWithdrawDialog(page, profB.id);
    await setControlledInputValue(page.locator("#propinas-withdrawal-amount"), "2000");
    await page.getByTestId("propinas-withdraw-confirm").click();
    await expect(page.getByTestId("propinas-toast")).toContainText(
      "Withdrawal completed successfully.",
      { timeout: 15_000 },
    );

    // Professional A: two tips and one withdrawal, all with the "Gs." prefix.
    await filterPropinasByProfessional(page, profA.fullName);
    await expect(propinasMovements(page)).toHaveCount(3, { timeout: 15_000 });
    await expect(propinasMovements(page).filter({ hasText: clientA1.fullName })).toContainText("Gs. 1.000");
    await expect(propinasMovements(page).filter({ hasText: clientA2.fullName })).toContainText("Gs. 1.000");
    const withdrawA = propinasMovements(page).filter({ hasText: "Withdrawal" });
    await expect(withdrawA).toHaveCount(1);
    await expect(withdrawA).toContainText("− Gs. 1.000");
    await expect(page.getByTestId("propinas-tips-total")).toHaveText("Gs. 2.000");
    await expect(page.getByTestId("propinas-withdrawn-total")).toHaveText("Gs. 1.000");

    // Professional B: one tip and one withdrawal.
    await filterPropinasByProfessional(page, profB.fullName);
    await expect(propinasMovements(page)).toHaveCount(2, { timeout: 15_000 });
    await expect(propinasMovements(page).filter({ hasText: clientB.fullName })).toContainText("Gs. 10.000");
    await expect(propinasMovements(page).filter({ hasText: "Withdrawal" })).toContainText("− Gs. 2.000");
    await expect(page.getByTestId("propinas-tips-total")).toHaveText("Gs. 10.000");
    await expect(page.getByTestId("propinas-withdrawn-total")).toHaveText("Gs. 2.000");
  });

  test("3+4 · los retiros de todo el salón se ven en Movimientos con montos en Gs., sin elegir profesional", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const ts = Date.now();
    const prof = await seedProfessional(request, token, `E2E137 History ${ts}`);
    const client = await seedClient(request, token, `E2E137 HistoryClient ${ts}`);
    await seedClosedTip(request, token, {
      clientId: client.id,
      serviceId: seed.serviceId,
      professionalId: prof.id,
      unitPrice: 45000,
      tipAmount: 5000,
    });

    await loginAsDemo(page);
    await page.goto("/app/propinas");

    // AC4: Movements are visible immediately, with no professional selected.
    await expect(page.getByTestId("propinas-movements")).toBeVisible();

    // AC3: the balance carries the "Gs." currency prefix.
    await expectBalance(page, prof.id, "Gs. 5.000");
    await openWithdrawDialog(page, prof.id);
    await expect(page.getByTestId("propinas-dialog-balance")).toHaveText("Gs. 5.000");
    await setControlledInputValue(page.locator("#propinas-withdrawal-amount"), "2000");
    await page.getByTestId("propinas-withdraw-confirm").click();
    await expect(page.getByTestId("propinas-toast")).toContainText(
      "Withdrawal completed successfully.",
      { timeout: 15_000 },
    );

    // AC4: the withdrawal appears in the salon-wide movements (with a Professional column), and
    // AC3: its amount also carries the "Gs." prefix.
    const historyRow = propinasMovements(page)
      .filter({ hasText: "Withdrawal" })
      .filter({ hasText: prof.fullName });
    await expect(historyRow).toHaveCount(1, { timeout: 15_000 });
    await expect(historyRow).toContainText("Gs. 2.000");
  });
});
