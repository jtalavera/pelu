import { expect, test } from "@playwright/test";
import {
  apiBaseUrl,
  apiPostJson,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { goToBillingHome, goToInvoiceHistory, searchInvoiceHistory } from "../fixtures/billing";

// The invoice detail ("Ver") dialog already shows a "SIFEN status" badge (see
// sifen-hu-07/08/09/10 specs). The lists also carry that information: the client detail page's
// invoice list keeps its "SIFEN status" column, while the redesigned Billing lists (today's
// invoices on the home, and the History) fold the invoice status and the SIFEN status into one
// plain-language state (Issued / In progress / Needs attention / Voided).
//
// Reuses the same test-only /api/admin/sifen-test-support fabrication pattern those specs already
// established (gated behind femme.data-init.enabled, only active in the e2e profile) to put an
// invoice into a known SIFEN status without depending on a live call to SIFEN's real test server.

async function createInvoice(
  request: import("@playwright/test").APIRequestContext,
  token: string,
  clientId: number,
  clientFullName: string,
  serviceId: number,
  serviceFullName: string,
): Promise<{ id: number }> {
  return apiPostJson<{ id: number }>(request, token, "/api/invoices", {
    clientId,
    clientDisplayName: clientFullName,
    clientRucOverride: null,
    clientIdentityDocumentOverride: null,
    lines: [
      {
        serviceId,
        description: serviceFullName,
        quantity: 1,
        unitPrice: 50000,
      },
    ],
    payments: [{ method: "CASH", amount: 50000 }],
  });
}

test.describe("Estado SIFEN en las listas de facturas", () => {
  test.beforeEach(async ({ request }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
  });

  test("today's invoices and History show an SIFEN-approved invoice as Issued", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E SifenCol ${Date.now()}`);
    const invoice = await createInvoice(
      request,
      token,
      client.id,
      client.fullName,
      seed.serviceId,
      seed.serviceFullName,
    );

    const prep = await request.post(
      `${apiBaseUrl()}/api/admin/sifen-test-support/invoices/${invoice.id}/prepare-as-approved`,
    );
    expect(prep.ok(), await prep.text()).toBeTruthy();

    await loginAsDemo(page);
    await page.goto("/app/billing");

    // Home — today's invoices (folded by default, so expand them first).
    await goToBillingHome(page);
    await page.getByTestId("billing-today-toggle").click();
    const todayRow = page
      .locator('[data-testid^="billing-today-row-"]')
      .filter({ hasText: client.fullName })
      .filter({ visible: true });
    await expect(todayRow).toBeVisible({ timeout: 30_000 });
    await expect(todayRow.locator("[data-invoice-state]")).toHaveAttribute("data-invoice-state", "issued");
    await expect(todayRow.getByText("Issued", { exact: true })).toBeVisible();

    // History — same invoice, same state.
    await goToInvoiceHistory(page);
    const historyRow = page
      .locator('[data-testid^="invoice-history-row-"]')
      .filter({ hasText: client.fullName })
      .filter({ visible: true });
    await expect(historyRow).toBeVisible({ timeout: 30_000 });
    await expect(historyRow.locator("[data-invoice-state]")).toHaveAttribute("data-invoice-state", "issued");
    await expect(historyRow.getByText("Issued", { exact: true })).toBeVisible();
  });

  test("an invoice queued for SIFEN submission shows as In progress", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E SifenColQueued ${Date.now()}`);
    const invoice = await createInvoice(
      request,
      token,
      client.id,
      client.fullName,
      seed.serviceId,
      seed.serviceFullName,
    );

    // RT-20 (Hardening_SIFEN.md): fabricates the "signed, not yet transmitted" state
    // prepareAndSign leaves an invoice in — same test-support fixture pattern the other cases in
    // this file already use.
    const prep = await request.post(
      `${apiBaseUrl()}/api/admin/sifen-test-support/invoices/${invoice.id}/prepare-with-status/QUEUED`,
    );
    expect(prep.ok(), await prep.text()).toBeTruthy();

    await loginAsDemo(page);
    await page.goto("/app/billing");
    await goToInvoiceHistory(page);
    await searchInvoiceHistory(page, client.fullName);
    const row = page
      .locator('[data-testid^="invoice-history-row-"]')
      .filter({ hasText: client.fullName })
      .filter({ visible: true });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row.locator("[data-invoice-state]")).toHaveAttribute("data-invoice-state", "processing");
    await expect(row.getByText("In progress", { exact: true })).toBeVisible();
  });

  test("an invoice never submitted to SIFEN shows as Issued, with no SIFEN sent date", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E SifenColDash ${Date.now()}`);
    // No sifen-test-support call — sifenSubmissionStatus stays null (SIFEN is disabled by default
    // for the demo tenant in the e2e profile, since V30's migration never runs there).
    await createInvoice(
      request,
      token,
      client.id,
      client.fullName,
      seed.serviceId,
      seed.serviceFullName,
    );

    await loginAsDemo(page);
    await page.goto("/app/billing");
    await goToInvoiceHistory(page);
    await searchInvoiceHistory(page, client.fullName);
    const row = page
      .locator('[data-testid^="invoice-history-row-"]')
      .filter({ hasText: client.fullName })
      .filter({ visible: true });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row.locator("[data-invoice-state]")).toHaveAttribute("data-invoice-state", "issued");
    await expect(row.getByTestId("invoice-row-sifen-sent")).toHaveCount(0);
  });

  test("Client detail page's invoice list shows the SIFEN status badge", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E SifenColClient ${Date.now()}`);
    const invoice = await createInvoice(
      request,
      token,
      client.id,
      client.fullName,
      seed.serviceId,
      seed.serviceFullName,
    );

    const prep = await request.post(
      `${apiBaseUrl()}/api/admin/sifen-test-support/invoices/${invoice.id}/prepare-as-approved`,
    );
    expect(prep.ok(), await prep.text()).toBeTruthy();

    await loginAsDemo(page);
    await page.goto(`/app/clients/${client.id}`);
    await page.getByRole("tab", { name: "Invoices" }).click();

    await expect(page.getByRole("columnheader", { name: "SIFEN status", exact: true })).toBeVisible({
      timeout: 30_000,
    });
    const row = page.locator("table tbody").getByRole("row").first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row.getByText("Approved", { exact: true })).toBeVisible();
  });
});
