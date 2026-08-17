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
    await expect(page.getByRole("tab", { name: "Tips report", selected: true })).toBeVisible();

    // Restrict to a single professional first, so both rows aren't already visible.
    await pickMultiSelectOption(
      page,
      "Professional",
      seed.professionalFullName.slice(0, 10),
      new RegExp(seed.professionalFullName),
    );
    await page.getByRole("button", { name: "Search", exact: true }).click();

    const reportRows = page.getByTestId("propinas-report-table").locator("tbody tr");
    await expect(reportRows.filter({ hasText: clientA.fullName })).toBeVisible({ timeout: 15_000 });
    await expect(reportRows.filter({ hasText: clientB.fullName })).toHaveCount(0);

    // AC1: "Clear" deselects the professional filter AND reloads with all professionals,
    // with no extra click on "Search" needed.
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(reportRows.filter({ hasText: clientA.fullName })).toBeVisible({ timeout: 15_000 });
    await expect(reportRows.filter({ hasText: clientB.fullName })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Professional", exact: true })).toHaveValue("");
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
    await pickMultiSelectOption(
      page,
      "Professional",
      seed.professionalFullName.slice(0, 10),
      new RegExp(seed.professionalFullName),
    );
    await page.getByRole("button", { name: "Search", exact: true }).click();

    const reportRows = page.getByTestId("propinas-report-table").locator("tbody tr");
    await expect(reportRows.filter({ hasText: clientNonZero.fullName })).toBeVisible({
      timeout: 15_000,
    });
    await expect(reportRows.filter({ hasText: clientZero.fullName })).toHaveCount(0);

    // Grand total only reflects the non-zero tip (a single professional selected renders no
    // per-professional subtotal row, so the grand total is the relevant net-of-zero assertion).
    const grandTotalRow = reportRows.filter({ hasText: "Grand total" });
    await expect(grandTotalRow.getByText(/^Gs\. 2\.000$/)).toBeVisible();
  });

  test("AC3 · un retiro de propina se refleja en los totales del reporte al volver a la pestaña", async ({
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
    await pickMultiSelectOption(
      page,
      "Professional",
      seed.professionalFullName.slice(0, 10),
      new RegExp(seed.professionalFullName),
    );
    await page.getByRole("button", { name: "Search", exact: true }).click();

    const reportRows = page.getByTestId("propinas-report-table").locator("tbody tr");
    const grandTotalRow = reportRows.filter({ hasText: "Grand total" });
    await expect(grandTotalRow.getByText(/^Gs\. 10\.000$/)).toBeVisible({ timeout: 15_000 });

    // Withdraw part of the balance from the Withdrawal tab.
    await page.getByRole("tab", { name: "Tip withdrawal" }).click();
    await expect(page.getByRole("tab", { name: "Tip withdrawal", selected: true })).toBeVisible();
    await pickSearchableOption(
      page,
      "Professional",
      seed.professionalFullName.slice(0, 10),
      new RegExp(seed.professionalFullName),
    );
    await expect(page.getByTestId("propinas-balance")).toHaveText("Gs. 10.000", { timeout: 15_000 });

    const amountInput = page.locator("#propinas-withdrawal-amount");
    await setControlledInputValue(amountInput, "1000");
    await expect(amountInput).toHaveValue("1.000");
    await page.getByRole("button", { name: "Withdraw", exact: true }).click();
    await expect(page.getByText("Withdrawal completed successfully.")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("propinas-balance")).toHaveText("Gs. 9.000");

    // AC3: switching back to the report tab (no manual "Search" click) shows the updated totals.
    await page.getByRole("tab", { name: "Tips report" }).click();
    await expect(page.getByRole("tab", { name: "Tips report", selected: true })).toBeVisible();

    await expect(grandTotalRow.getByText(/^Gs\. 9\.000$/)).toBeVisible({ timeout: 15_000 });
  });
});
