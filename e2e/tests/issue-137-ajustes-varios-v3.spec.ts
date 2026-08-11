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
import { pickSearchableOption, setControlledInputValue } from "../fixtures/ui";

test.describe.configure({ mode: "serial" });

type ServiceRecordSeed = { id: number; status: string };

async function seedProfessional(
  request: APIRequestContext,
  token: string,
  fullName: string,
): Promise<{ id: number; fullName: string }> {
  const prof = await apiPostJson<{ id: number }>(request, token, "/api/professionals", {
    fullName,
    phone: null,
    email: null,
    photoDataUrl: null,
  });
  return { id: prof.id, fullName };
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

/** Picks options from the report tab's professional `MultiSelect` filter, one at a time. */
async function pickMultiSelectOption(
  page: Page,
  accessibleName: string,
  filterText: string,
  optionNamePattern: RegExp,
): Promise<void> {
  const cb = page.getByRole("combobox", { name: accessibleName, exact: true });
  await cb.click();
  await cb.fill(filterText);
  await page
    .getByRole("listbox", { name: accessibleName, exact: true })
    .getByRole("button", { name: optionNamePattern })
    .first()
    .click();
}

test.describe("Issue #137 · Ajustes varios v3", () => {
  let seed: SeededSalon;

  test.beforeEach(async ({ request }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    seed = await seedCategoryServiceProfessional(request, token);
  });

  test("1+2+3 · el reporte de propinas ordena el retiro dentro del grupo del profesional, sin línea de total, con moneda", async ({
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
    await page.getByRole("tab", { name: "Tip withdrawal" }).click();
    await pickSearchableOption(page, "Professional", "E2E137 AAA Monica", new RegExp(profA.fullName));
    await expect(page.getByTestId("propinas-balance")).toHaveText("Gs. 2.000", { timeout: 15_000 });
    await setControlledInputValue(page.locator("#propinas-withdrawal-amount"), "1000");
    await page.getByRole("button", { name: "Withdraw", exact: true }).click();
    await expect(page.getByText("Withdrawal completed successfully.")).toBeVisible({
      timeout: 15_000,
    });

    await pickSearchableOption(page, "Professional", "E2E137 ZZZ Jorgelina", new RegExp(profB.fullName));
    await expect(page.getByTestId("propinas-balance")).toHaveText("Gs. 10.000", { timeout: 15_000 });
    await setControlledInputValue(page.locator("#propinas-withdrawal-amount"), "2000");
    await page.getByRole("button", { name: "Withdraw", exact: true }).click();
    await expect(page.getByText("Withdrawal completed successfully.")).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole("tab", { name: "Tips report" }).click();
    await pickMultiSelectOption(page, "Professional", "E2E137 AAA Monica", new RegExp(profA.fullName));
    await pickMultiSelectOption(page, "Professional", "E2E137 ZZZ Jorgelina", new RegExp(profB.fullName));
    await page.getByRole("button", { name: "Search", exact: true }).click();

    const reportRows = page.getByTestId("propinas-report-table").locator("tbody tr");
    await expect(reportRows.filter({ hasText: clientB.fullName })).toBeVisible({ timeout: 15_000 });

    // AC1+AC2: exact row order — both tip rows for A, then A's withdrawal, then A's subtotal,
    // then B's tip row, then B's withdrawal, then B's subtotal, then the grand total. No standalone
    // "Total manual withdrawals" row exists anywhere in the table.
    const rowTexts = (await reportRows.allTextContents()).map((t) => t.replace(/\s+/g, " ").trim());
    const idxTip1 = rowTexts.findIndex((t) => t.includes(clientA1.fullName));
    const idxTip2 = rowTexts.findIndex((t) => t.includes(clientA2.fullName));
    const idxWithdrawA = rowTexts.findIndex((t) => t.includes(`Manual withdrawal — ${profA.fullName}`));
    const idxSubtotalA = rowTexts.findIndex((t) => t.includes(`Subtotal — ${profA.fullName}`));
    const idxTipB = rowTexts.findIndex((t) => t.includes(clientB.fullName));
    const idxWithdrawB = rowTexts.findIndex((t) => t.includes(`Manual withdrawal — ${profB.fullName}`));
    const idxSubtotalB = rowTexts.findIndex((t) => t.includes(`Subtotal — ${profB.fullName}`));
    const idxGrandTotal = rowTexts.findIndex((t) => t.includes("Grand total"));

    for (const idx of [
      idxTip1,
      idxTip2,
      idxWithdrawA,
      idxSubtotalA,
      idxTipB,
      idxWithdrawB,
      idxSubtotalB,
      idxGrandTotal,
    ]) {
      expect(idx).toBeGreaterThanOrEqual(0);
    }
    expect(idxWithdrawA).toBeGreaterThan(Math.max(idxTip1, idxTip2));
    expect(idxSubtotalA).toBeGreaterThan(idxWithdrawA);
    expect(idxTipB).toBeGreaterThan(idxSubtotalA);
    expect(idxWithdrawB).toBeGreaterThan(idxTipB);
    expect(idxSubtotalB).toBeGreaterThan(idxWithdrawB);
    expect(idxGrandTotal).toBeGreaterThan(idxSubtotalB);

    expect(rowTexts.some((t) => t.includes("Total manual withdrawals"))).toBe(false);

    // AC3: every monetary value in the report carries the "Gs." currency prefix.
    const withdrawalRowA = reportRows.filter({
      hasText: `Manual withdrawal — ${profA.fullName}`,
    });
    await expect(withdrawalRowA.getByText(/^Gs\. 1\.000$/)).toBeVisible();
    await expect(withdrawalRowA).toHaveClass(/text-red-600/);
    const subtotalRowA = reportRows.filter({ hasText: `Subtotal — ${profA.fullName}` });
    await expect(subtotalRowA.getByText(/^Gs\. 1\.000$/)).toBeVisible();

    const withdrawalRowB = reportRows.filter({
      hasText: `Manual withdrawal — ${profB.fullName}`,
    });
    await expect(withdrawalRowB.getByText(/^Gs\. 2\.000$/)).toBeVisible();
    await expect(withdrawalRowB).toHaveClass(/text-red-600/);
    const subtotalRowB = reportRows.filter({ hasText: `Subtotal — ${profB.fullName}` });
    await expect(subtotalRowB.getByText(/^Gs\. 8\.000$/)).toBeVisible();

    // Grand total = (1.000 + 1.000 - 1.000) + (10.000 - 2.000) = 9.000.
    const grandTotalRow = reportRows.filter({ hasText: "Grand total" });
    await expect(grandTotalRow.getByText(/^Gs\. 9\.000$/)).toBeVisible();
  });

  test("3+4 · el historial de retiros siempre está visible con montos en Gs., sin seleccionar profesional", async ({
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
    await page.getByRole("tab", { name: "Tip withdrawal" }).click();
    await expect(page.getByRole("tab", { name: "Tip withdrawal", selected: true })).toBeVisible();

    // AC4: the history section is visible immediately, before any professional is selected.
    await expect(page.getByText("Select a professional to see their accumulated tip balance.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Withdrawal history" })).toBeVisible();

    await pickSearchableOption(page, "Professional", "E2E137 History", new RegExp(prof.fullName));
    // AC3: the balance carries the "Gs." currency prefix.
    await expect(page.getByTestId("propinas-balance")).toHaveText("Gs. 5.000", { timeout: 15_000 });
    await setControlledInputValue(page.locator("#propinas-withdrawal-amount"), "2000");
    await page.getByRole("button", { name: "Withdraw", exact: true }).click();
    await expect(page.getByText("Withdrawal completed successfully.")).toBeVisible({
      timeout: 15_000,
    });

    // AC4: the withdrawal appears in the tenant-wide history (with a Profesional column), and AC3:
    // its amount also carries the "Gs." prefix.
    const historyRow = page
      .getByTestId("propinas-withdrawal-history-table")
      .locator("tbody tr")
      .filter({ hasText: prof.fullName });
    await expect(historyRow).toBeVisible({ timeout: 15_000 });
    await expect(historyRow.getByText(/^Gs\. 2\.000$/)).toBeVisible();
  });
});
