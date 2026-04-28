import { expect, test } from "@playwright/test";
import {
  apiPutJson,
  ensureActiveFiscalStampForInvoices,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { ensureCashSessionOpen } from "../fixtures/billing";
import { clickIssueInvoiceAndExpectSuccess, pickServiceLine } from "../fixtures/invoice";

test.describe("HU-17 · Anular comprobante", () => {
  test.beforeEach(async ({ request }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
  });



  test("HU-17 · 1 y 2 anular con razón obligatoria", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    await apiPutJson(request, token, "/api/business-profile", {
      businessName: "Demo salon",
      ruc: "80000005-6",
      address: null,
      phone: null,
      contactEmail: null,
      logoDataUrl: null,
    });
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E Void ${Date.now()}`);

    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "New Invoice" }).click();
    await page.getByLabel("Search or select client").fill(client.fullName.slice(0, 8));
    await page.getByRole("button", { name: client.fullName }).click();
    await pickServiceLine(page, seed.serviceFullName, 0);
    await page.locator("#line-price-0").fill("8000");
    await page.locator("#pay-amount-0").fill("8000");
    await clickIssueInvoiceAndExpectSuccess(page);

    await page.getByRole("tab", { name: "History" }).click();
    await page.getByRole("button", { name: "View" }).first().click();
    await page.getByRole("button", { name: "Void invoice" }).click();
    await page.getByRole("button", { name: "Confirm void" }).click();
    await expect(page.getByText("Enter a reason.", { exact: true })).toBeVisible();
    await page.locator("#void-reason").fill("E2E void reason");
    const [voidRes] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes("/api/invoices/") &&
          r.url().endsWith("/void") &&
          r.request().method() === "POST",
        { timeout: 30_000 },
      ),
      page.getByRole("button", { name: "Confirm void" }).click(),
    ]);
    expect(voidRes.ok(), await voidRes.text()).toBeTruthy();
  });

  test("HU-17 · 3 estado anulado visible en historial", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    await apiPutJson(request, token, "/api/business-profile", {
      businessName: "Demo salon",
      ruc: "80000005-6",
      address: null,
      phone: null,
      contactEmail: null,
      logoDataUrl: null,
    });
    const seed = await seedCategoryServiceProfessional(request, token);
    const clientName = `E2E Vo2 ${Date.now()}`;
    const client = await seedClient(request, token, clientName);

    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "New Invoice" }).click();
    await page.getByLabel("Search or select client").fill("E2E Vo2");
    await page.getByRole("button", { name: clientName }).click();
    await pickServiceLine(page, seed.serviceFullName, 0);
    await page.locator("#line-price-0").fill("3000");
    await page.locator("#pay-amount-0").fill("3000");
    await clickIssueInvoiceAndExpectSuccess(page);
    // Navigate fresh to ensure History loads up-to-date invoice data
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "History" }).click();
    // Filter by unique client name to isolate this invoice from previous test runs
    await page.locator("#invoice-history-text-filter").fill(clientName);
    const clientRow = page.locator("tbody").getByRole("row").first();
    await expect(clientRow).toBeVisible({ timeout: 15_000 });
    await clientRow.getByRole("button", { name: "View" }).click();
    await page.getByRole("button", { name: "Void invoice" }).click();
    await page.locator("#void-reason").fill("Wrong amount");
    const [voidRes2] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes("/api/invoices/") &&
          r.url().endsWith("/void") &&
          r.request().method() === "POST",
        { timeout: 30_000 },
      ),
      page.getByRole("button", { name: "Confirm void" }).click(),
    ]);
    expect(voidRes2.ok(), await voidRes2.text()).toBeTruthy();
    // After void the detail closes; verify the row now shows Voided status
    await expect(
      page.locator("tbody").getByRole("row").filter({ hasText: "Voided" }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});
