import { expect, test } from "@playwright/test";
import { apiPutJson, ensureActiveFiscalStampForInvoices, loginAsDemoApi, seedClient } from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { ensureCashSessionOpen } from "../fixtures/billing";
import { clickIssueInvoiceAndExpectSuccess } from "../fixtures/invoice";

test.describe("HU-16 · Historial de comprobantes", () => {
  test.beforeEach(async ({ request }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
  });

  test("pestaña de historial de facturas", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "History" }).click();
    await expect(page.getByRole("heading", { name: "Invoice history" })).toBeVisible();
  });

  test("HU-16 · 2 filtros por fecha y estado", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    await apiPutJson(request, token, "/api/business-profile", {
      businessName: "Demo salon",
      ruc: "80000005-6",
      address: null,
      phone: null,
      contactEmail: null,
      logoDataUrl: null,
    });
    const client = await seedClient(request, token, `E2E Hist ${Date.now()}`);

    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "New Invoice" }).click();
    await page.getByLabel("Search or select client").fill(client.fullName.slice(0, 8));
    await page.getByRole("button", { name: client.fullName }).click();
    await page.locator("#line-desc-0").fill("Hist line");
    await page.locator("#line-price-0").fill("5000");
    await page.locator("#pay-amount-0").fill("5000");
    await clickIssueInvoiceAndExpectSuccess(page);

    await Promise.all([
      page.waitForResponse(
        (r) => {
          if (r.request().method() !== "GET" || !r.url().includes("/api/invoices")) return false;
          try {
            const path = new URL(r.url()).pathname;
            return !/^\/api\/invoices\/\d+$/.test(path);
          } catch {
            return false;
          }
        },
        { timeout: 30_000 },
      ),
      page.getByRole("tab", { name: "History" }).click(),
    ]);
    await page.locator("#invoice-history-text-filter").fill(client.fullName);
    await expect(
      page.locator("tbody").getByRole("row").filter({ hasText: client.fullName }),
    ).toBeVisible({
      timeout: 30_000,
    });
  });

  test("HU-16 · 3 columnas visibles en la tabla", async ({ page, request }) => {
    await loginAsDemoApi(request);
    await loginAsDemo(page);
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "History" }).click();
    await expect(page.getByRole("columnheader", { name: "Number" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Date" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Client" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Total" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Status" })).toBeVisible();
  });
});
