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

// The invoice detail ("Ver") dialog already shows a "SIFEN status" badge (see
// sifen-hu-07/08/09/10 specs). This adds the same information as a column on every table that
// lists invoices: Billing → Cash Register → today's invoices, Billing → History, and the client
// detail page's own invoice list — all three consume the same InvoiceListItem/SifenStatusBadge.
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

test.describe("Estado SIFEN column on invoice tables", () => {
  test.beforeEach(async ({ request }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
  });

  test("Cash Register today's invoices and History both show the SIFEN status badge", async ({
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

    // Cash Register tab (default) — today's invoices table. Its rows are <tr role="button">
    // (issue #198), so match by tag, and scope to the visible tab (billing keeps every tab
    // mounted, hidden via the `hidden` attribute).
    await expect(page.getByRole("columnheader", { name: "SIFEN status", exact: true })).toBeVisible({
      timeout: 30_000,
    });
    const todayRow = page
      .locator('tbody tr[role="button"]')
      .filter({ hasText: client.fullName })
      .filter({ visible: true });
    await expect(todayRow).toBeVisible({ timeout: 30_000 });
    await expect(todayRow.getByText("Approved", { exact: true })).toBeVisible();

    // History tab — same invoice, same column.
    await page.getByRole("tab", { name: "History" }).click();
    await expect(page.getByRole("columnheader", { name: "SIFEN status", exact: true })).toBeVisible();
    // History rows are <tr role="button"> (issue #163 AC10), so their a11y role is "button",
    // not "row" — match by tag instead of getByRole("row").
    const historyRow = page
      .locator("tbody tr[role=\"button\"]")
      .filter({ hasText: client.fullName })
      .filter({ visible: true });
    await expect(historyRow).toBeVisible({ timeout: 30_000 });
    await expect(historyRow.getByText("Approved", { exact: true })).toBeVisible();
  });

  test("an invoice queued for SIFEN submission shows the Queued badge", async ({
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
    await page.getByRole("tab", { name: "History" }).click();
    await page.locator("#invoice-history-text-filter").fill(client.fullName);
    const row = page
      .locator("tbody tr[role=\"button\"]")
      .filter({ hasText: client.fullName })
      .filter({ visible: true });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row.getByText("Queued", { exact: true })).toBeVisible();
  });

  test("an invoice never submitted to SIFEN shows a dash instead of a badge", async ({
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
    await page.getByRole("tab", { name: "History" }).click();
    await page.locator("#invoice-history-text-filter").fill(client.fullName);
    const row = page
      .locator("tbody tr[role=\"button\"]")
      .filter({ hasText: client.fullName })
      .filter({ visible: true });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText("—");
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
    await page.getByRole("tab", { name: /history/i }).click();

    await expect(page.getByRole("columnheader", { name: "SIFEN status", exact: true })).toBeVisible({
      timeout: 30_000,
    });
    const row = page.locator("table tbody").getByRole("row").first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row.getByText("Approved", { exact: true })).toBeVisible();
  });
});
