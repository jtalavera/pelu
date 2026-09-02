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

async function seedOpenRecordWithLines(
  request: APIRequestContext,
  token: string,
  params: {
    clientId: number;
    serviceId: number;
    professionalId: number;
    unitPrice: number;
    lineCount: number;
  },
): Promise<ServiceRecordSeed> {
  return apiPostJson<ServiceRecordSeed>(request, token, "/api/service-records", {
    clientId: params.clientId,
    lines: Array.from({ length: params.lineCount }, () => ({
      serviceId: params.serviceId,
      professionalId: params.professionalId,
      quantity: 1,
      unitPrice: params.unitPrice,
    })),
    tips: [{ professionalId: params.professionalId, amount: 0 }],
  });
}

async function seedProfessional(
  request: APIRequestContext,
  token: string,
  fullName: string,
): Promise<{ id: number }> {
  return apiPostJson<{ id: number }>(request, token, "/api/professionals", {
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

test.describe("Issue #135 · Ajustes varios v2", () => {
  let seed: SeededSalon;

  test.beforeEach(async ({ request }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    seed = await seedCategoryServiceProfessional(request, token);
  });

  test("1 · al actualizar una ficha desde Historial de fichas, la pantalla se posiciona arriba mostrando el mensaje de respuesta", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 380, height: 380 });
    const token = await loginAsDemoApi(request);
    const client = await seedClient(request, token, `E2E135 Hist ${Date.now()}`);
    await seedOpenRecordWithLines(request, token, {
      clientId: client.id,
      serviceId: seed.serviceId,
      professionalId: seed.professionalId,
      unitPrice: 50000,
      lineCount: 4,
    });

    await loginAsDemo(page);
    await page.goto("/app/service-records");
    await page.getByRole("tab", { name: "History", exact: true }).click();
    await page.locator("#service-record-history-text-filter").fill(client.fullName);
    await page
      .locator('tbody tr[role="button"]')
      .filter({ hasText: client.fullName })
      .click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const scrollContainer = dialog.locator(".overflow-y-auto");

    // Scroll down to the tips section (bottom of the form) before saving, simulating a user who
    // scrolled past the top alert area to edit a field further down.
    // Retry the scroll-then-check as a poll: a transient reflow (e.g. the professionals dropdown
    // finishing its async load) can otherwise reset scrollTop between the one-shot set and check.
    await expect
      .poll(async () => {
        await scrollContainer.evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        });
        return scrollContainer.evaluate((el) => el.scrollTop);
      })
      .toBeGreaterThan(0);

    const tipInput = dialog.locator(`#service-record-tip-${seed.professionalId}`);
    await setControlledInputValue(tipInput, "1000");
    await dialog.getByTestId("service-record-submit").click();

    await expect(dialog.getByText("Changes saved.")).toBeVisible({ timeout: 15_000 });
    // The alert must be visible without further scrolling — not merely present in the DOM below
    // the fold — and the container must have scrolled back up from where it was left.
    await expect(dialog.getByText("Changes saved.")).toBeInViewport();
    await expect
      .poll(() => scrollContainer.evaluate((el) => el.scrollTop))
      .toBeLessThan(50);
  });

  test("1b · al actualizar una ficha desde el Panel, la pantalla se posiciona arriba mostrando el mensaje de respuesta", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 380, height: 380 });
    const token = await loginAsDemoApi(request);
    const client = await seedClient(request, token, `E2E135 Panel ${Date.now()}`);
    await seedOpenRecordWithLines(request, token, {
      clientId: client.id,
      serviceId: seed.serviceId,
      professionalId: seed.professionalId,
      unitPrice: 50000,
      lineCount: 4,
    });

    await loginAsDemo(page);
    await page.goto("/app");
    const grid = page.getByTestId("dashboard-service-records-grid");
    await expect(grid).toBeVisible({ timeout: 15_000 });
    await grid
      .getByTestId("dashboard-service-record-card")
      .filter({ hasText: client.fullName })
      .first()
      .click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const scrollContainer = dialog.locator(".overflow-y-auto");

    // Retry the scroll-then-check as a poll: a transient reflow (e.g. the professionals dropdown
    // finishing its async load) can otherwise reset scrollTop between the one-shot set and check.
    await expect
      .poll(async () => {
        await scrollContainer.evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        });
        return scrollContainer.evaluate((el) => el.scrollTop);
      })
      .toBeGreaterThan(0);

    const tipInput = dialog.locator(`#service-record-tip-${seed.professionalId}`);
    await setControlledInputValue(tipInput, "1000");
    await dialog.getByTestId("service-record-submit").click();

    await expect(dialog.getByText("Changes saved.")).toBeVisible({ timeout: 15_000 });
    // The alert must be visible without further scrolling — not merely present in the DOM below
    // the fold — and the container must have scrolled back up from where it was left.
    await expect(dialog.getByText("Changes saved.")).toBeInViewport();
    await expect
      .poll(() => scrollContainer.evaluate((el) => el.scrollTop))
      .toBeLessThan(50);
  });

  test("2 · el reporte de propinas muestra los retiros manuales por profesional y un total general, ambos en rojo", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const profB = await seedProfessional(request, token, `E2E135 Prof B ${Date.now()}`);

    const clientA = await seedClient(request, token, `E2E135 ClientA ${Date.now()}`);
    await seedClosedTip(request, token, {
      clientId: clientA.id,
      serviceId: seed.serviceId,
      professionalId: seed.professionalId,
      unitPrice: 50000,
      tipAmount: 10000,
    });
    const clientB = await seedClient(request, token, `E2E135 ClientB ${Date.now()}`);
    await seedClosedTip(request, token, {
      clientId: clientB.id,
      serviceId: seed.serviceId,
      professionalId: profB.id,
      unitPrice: 50000,
      tipAmount: 8000,
    });

    await loginAsDemo(page);
    await page.goto("/app/propinas");

    // Withdraw part of each professional's balance.
    await page.getByRole("tab", { name: "Tip withdrawal" }).click();
    await pickSearchableOption(
      page,
      "Professional",
      seed.professionalFullName.slice(0, 10),
      new RegExp(seed.professionalFullName),
    );
    await expect(page.getByTestId("propinas-balance")).toHaveText("Gs. 10.000", { timeout: 15_000 });
    await setControlledInputValue(page.locator("#propinas-withdrawal-amount"), "4000");
    await page.getByRole("button", { name: "Withdraw", exact: true }).click();
    await expect(page.getByText("Withdrawal completed successfully.")).toBeVisible({
      timeout: 15_000,
    });

    await pickSearchableOption(page, "Professional", "E2E135 Prof B", /E2E135 Prof B/i);
    await expect(page.getByTestId("propinas-balance")).toHaveText("Gs. 8.000", { timeout: 15_000 });
    await setControlledInputValue(page.locator("#propinas-withdrawal-amount"), "2000");
    await page.getByRole("button", { name: "Withdraw", exact: true }).click();
    await expect(page.getByText("Withdrawal completed successfully.")).toBeVisible({
      timeout: 15_000,
    });

    // Back on the report tab, filtered to just these two professionals.
    await page.getByRole("tab", { name: "Tips report" }).click();
    await pickMultiSelectOption(
      page,
      "Professional",
      seed.professionalFullName.slice(0, 10),
      new RegExp(seed.professionalFullName),
    );
    await pickMultiSelectOption(page, "Professional", "E2E135 Prof B", /E2E135 Prof B/i);
    await page.getByRole("button", { name: "Search", exact: true }).click();

    const reportRows = page.getByTestId("propinas-report-table").locator("tbody tr");

    const withdrawalRowA = reportRows.filter({
      hasText: `Manual withdrawal — ${seed.professionalFullName}`,
    });
    await expect(withdrawalRowA).toBeVisible({ timeout: 15_000 });
    await expect(withdrawalRowA.getByText(/^Gs\. 4\.000$/)).toBeVisible();
    await expect(withdrawalRowA).toHaveClass(/text-red-600/);

    const withdrawalRowB = reportRows.filter({
      hasText: "Manual withdrawal — E2E135 Prof B",
    });
    await expect(withdrawalRowB).toBeVisible({ timeout: 15_000 });
    await expect(withdrawalRowB.getByText(/^Gs\. 2\.000$/)).toBeVisible();
    await expect(withdrawalRowB).toHaveClass(/text-red-600/);

    // Issue #137: the aggregate "Total manual withdrawals" row was removed — each withdrawal now
    // lives only inside its professional's own group.
    await expect(reportRows.filter({ hasText: "Total manual withdrawals" })).toHaveCount(0);

    const grandTotalRow = reportRows.filter({ hasText: "Grand total" });
    await expect(grandTotalRow.getByText(/^Gs\. 12\.000$/)).toBeVisible();
  });
});
