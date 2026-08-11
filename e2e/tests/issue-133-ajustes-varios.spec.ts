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

test.describe("Issue #133 · Ajustes varios", () => {
  let seed: SeededSalon;

  test.beforeEach(async ({ request }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    seed = await seedCategoryServiceProfessional(request, token);
  });

  test("1 · el formulario de nueva ficha no muestra una línea de servicio en blanco", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await page.goto("/app/service-records");
    await expect(page.getByRole("tab", { name: "New record", exact: true })).toBeVisible();

    // No pre-seeded blank line — only the "Add service" button.
    await expect(page.locator('[id^="service-record-line-svc-"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add service" })).toBeVisible();

    // Clicking "Add service" adds exactly one line, on demand.
    await page.getByRole("button", { name: "Add service" }).click();
    await expect(page.locator('[id^="service-record-line-svc-"]')).toHaveCount(1);
  });

  test("2 · el reporte de propinas agrega una línea Retiros manuales que refleja el balance del período", async ({
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
    await pickMultiSelectOption(
      page,
      "Professional",
      seed.professionalFullName.slice(0, 10),
      new RegExp(seed.professionalFullName),
    );
    await page.getByRole("button", { name: "Search", exact: true }).click();

    const reportRows = page.getByTestId("propinas-report-table").locator("tbody tr");
    const withdrawalsRow = reportRows.filter({
      hasText: `Manual withdrawal — ${seed.professionalFullName}`,
    });
    const grandTotalRow = reportRows.filter({ hasText: "Grand total" });

    // Before any withdrawal: no withdrawal row yet, grand total is the full generated tip.
    await expect(withdrawalsRow).toHaveCount(0);
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
    await setControlledInputValue(amountInput, "3000");
    await expect(amountInput).toHaveValue("3.000");
    await page.getByRole("button", { name: "Withdraw", exact: true }).click();
    await expect(page.getByText("Withdrawal completed successfully.")).toBeVisible({
      timeout: 15_000,
    });

    // Back on the report tab, a "Retiro manual" row now shows the withdrawn amount inside the
    // professional's group, and the grand total = generated tips (10.000) - withdrawals (3.000).
    await page.getByRole("tab", { name: "Tips report" }).click();
    await expect(page.getByRole("tab", { name: "Tips report", selected: true })).toBeVisible();

    await expect(withdrawalsRow.getByText(/^Gs\. 3\.000$/)).toBeVisible({ timeout: 15_000 });
    await expect(grandTotalRow.getByText(/^Gs\. 7\.000$/)).toBeVisible();
  });
});
