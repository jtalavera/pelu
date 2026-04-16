import { expect, test } from "@playwright/test";
import {
  API_BASE,
  apiPostJson,
  apiPutJson,
  ensureActiveFiscalStampForInvoices,
  isoDateLocal,
  listFiscalStamps,
  loginAsDemoApi,
  seedClient,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { ensureCashSessionOpen } from "../fixtures/billing";
import { clickIssueInvoiceAndExpectSuccess } from "../fixtures/invoice";

test.describe("HU-14 · Emitir comprobante", () => {
  test.beforeEach(async ({ request }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
  });

  test("formulario de emisión de factura", async ({ page }) => {
    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "New Invoice" }).click();
    await expect(page.getByRole("heading", { name: "Issue Invoice" })).toBeVisible();
  });

  test("HU-14 · 2 varios ítems y HU-14 · 6 método de pago", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    await apiPutJson(request, token, "/api/business-profile", {
      businessName: "Demo salon",
      ruc: "80000005-6",
      address: null,
      phone: null,
      contactEmail: null,
      logoDataUrl: null,
    });
    const client = await seedClient(request, token, `E2E Inv ${Date.now()}`);

    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "New Invoice" }).click();
    await page.getByLabel("Search or select client").fill(client.fullName.slice(0, 6));
    await page.getByRole("button", { name: client.fullName }).click();
    await page.locator("#line-desc-0").fill("Item A");
    await page.locator("#line-price-0").fill("5000");
    await page.getByRole("button", { name: "Add item" }).click();
    await page.locator("#line-desc-1").fill("Item B");
    await page.locator("#line-price-1").fill("3000");
    await page.locator("#pay-amount-0").fill("8000");
    await clickIssueInvoiceAndExpectSuccess(page);
  });

  test("HU-14 · 3 cliente ocasional", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    await apiPutJson(request, token, "/api/business-profile", {
      businessName: "Demo salon",
      ruc: "80000005-6",
      address: null,
      phone: null,
      contactEmail: null,
      logoDataUrl: null,
    });
    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "New Invoice" }).click();
    await page.getByLabel("Search or select client").click();
    await page.getByRole("button", { name: "Occasional client" }).click();
    await page.getByLabel("Client display name").fill("Occ E2E");
    await page.locator("#line-desc-0").fill("Walk-in");
    await page.locator("#line-price-0").fill("15000");
    await page.locator("#pay-amount-0").fill("15000");
    await clickIssueInvoiceAndExpectSuccess(page);
  });

  test("HU-14 · 5 descuento porcentaje", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    await apiPutJson(request, token, "/api/business-profile", {
      businessName: "Demo salon",
      ruc: "80000005-6",
      address: null,
      phone: null,
      contactEmail: null,
      logoDataUrl: null,
    });
    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "New Invoice" }).click();
    await page.getByLabel("Discount type").selectOption("PERCENT");
    await page.getByLabel(/Discount value/i).fill("10");
    await page.getByLabel("Client display name").fill("Disc E2E");
    await page.locator("#line-desc-0").fill("Hair");
    await page.locator("#line-price-0").fill("10000");
    await page.locator("#pay-amount-0").fill("9000");
    await clickIssueInvoiceAndExpectSuccess(page);
  });

  test("HU-14 · 8 sin timbrado activo bloquea emisión", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const stamps = await listFiscalStamps(request, token);
    for (const s of stamps) {
      await request.post(`${API_BASE}/api/fiscal-stamps/${s.id}/deactivate`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }

    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "New Invoice" }).click();
    await page.getByLabel("Client display name").fill("No stamp");
    await page.locator("#line-desc-0").fill("X");
    await page.locator("#line-price-0").fill("1000");
    await page.locator("#pay-amount-0").fill("1000");
    await page.getByRole("button", { name: "Issue invoice" }).click();
    await expect(
      page.getByText("No active fiscal stamp. Go to Settings → Timbrado to activate one.", {
        exact: true,
      }),
    ).toBeVisible();

    const today = new Date();
    const nextYear = new Date(today);
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    const created = await apiPostJson<{ id: number }>(request, token, "/api/fiscal-stamps", {
      stampNumber: `7${Date.now().toString().slice(-7)}`,
      validFrom: isoDateLocal(today),
      validUntil: isoDateLocal(nextYear),
      rangeFrom: 1,
      rangeTo: 9_999_999,
      initialEmissionNumber: Math.max(100, stamps[0]?.nextEmissionNumber ?? 100),
    });
    await apiPostJson(request, token, `/api/fiscal-stamps/${created.id}/activate`, {});
  });
});
