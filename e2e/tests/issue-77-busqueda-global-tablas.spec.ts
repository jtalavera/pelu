/**
 * Issue #77 · Búsqueda en tablas debe ser global (server-side filtering).
 *
 * Acceptance criteria:
 * 1. Clients search is applied server-side and matches clients on any page.
 * 2. Clients status pills (All / Active / With RUC / New) filter server-side
 *    across the full dataset and combine with the text search.
 * 3. Clients table uses the standard server-side pagination: 10/25/50 rows
 *    (default 10); changing search, pill, or page size resets to page 1.
 * 4. CSV export contains all rows matching the current filters, not just the
 *    visible page.
 * 5. Services and billing-history searches are global (regression).
 */

import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { loginAsDemo } from "../fixtures/auth";
import {
  apiPostJson,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedClient,
} from "../fixtures/api";

// ── Seeding helpers ─────────────────────────────────────────────────────────

/** Seeds 11 clients "<tag> A00".."<tag> A10" plus one "<tag> Z Target". */
async function seedClientBatch(
  request: APIRequestContext,
  token: string,
  tag: string,
): Promise<{ firstId: number; targetName: string }> {
  let firstId = 0;
  for (let i = 0; i < 11; i++) {
    const created = await seedClient(request, token, `${tag} A${String(i).padStart(2, "0")}`);
    if (i === 0) firstId = created.id;
  }
  const targetName = `${tag} Z Target`;
  await seedClient(request, token, targetName);
  return { firstId, targetName };
}

async function gotoClients(page: Page): Promise<void> {
  await loginAsDemo(page);
  await page.goto("/app/clients");
  await page.waitForTimeout(600); // let the debounced first fetch land
}

async function searchClients(page: Page, q: string): Promise<void> {
  await page.locator("#clients-inline-search").fill(q);
  await page.waitForTimeout(600); // debounce
}

// ── AC1 · Search reaches clients beyond the visible page ────────────────────

test.describe("Issue #77 · Clients search is global", () => {
  test("#77-1 · search matches a client that is not on the current page", async ({
    page,
    request,
  }) => {
    const tag = `I77S${Date.now()}`;
    const token = await loginAsDemoApi(request);
    const { targetName } = await seedClientBatch(request, token, tag);

    await gotoClients(page);

    // Narrow to the 12 seeded clients: page 1 holds A00..A09, target is 12th.
    await searchClients(page, tag);
    await expect(page.getByText(/1–10 of 12/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(targetName, { exact: true })).toHaveCount(0);

    // Refining the search must find the page-2 client (server-side, global).
    await searchClients(page, `${tag} Z`);
    await expect(page.getByText(targetName, { exact: true })).toBeVisible();
    await expect(page.getByText(/1–1 of 1/)).toBeVisible();
  });

  // ── AC2 · Status pills filter across all pages ────────────────────────────

  test("#77-2 · Active pill filters server-side across all pages and combines with search", async ({
    page,
    request,
  }) => {
    const tag = `I77P${Date.now()}`;
    const token = await loginAsDemoApi(request);
    const { firstId } = await seedClientBatch(request, token, tag);
    await apiPostJson(request, token, `/api/clients/${firstId}/deactivate`, {});

    await gotoClients(page);
    await searchClients(page, tag);
    await expect(page.getByText(/1–10 of 12/)).toBeVisible({ timeout: 10_000 });

    // Move to page 2 first: clicking a pill must reset to page 1.
    await page.getByRole("button", { name: /next/i }).click();
    await page.waitForTimeout(600);
    await expect(page.getByText(/11–12 of 12/)).toBeVisible();

    // Active pill: the deactivated client (on page 1 alphabetically) drops out
    // of the total count — proving the filter ran server-side, not on the page.
    await page.getByRole("button", { name: "Active", exact: true }).click();
    await page.waitForTimeout(600);
    await expect(page.getByText(/1–10 of 11/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(`${tag} A00`, { exact: true })).toHaveCount(0);

    // Back to All: the inactive client is counted again.
    await page.getByRole("button", { name: "All", exact: true }).click();
    await page.waitForTimeout(600);
    await expect(page.getByText(/1–10 of 12/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(`${tag} A00`, { exact: true })).toBeVisible();
  });

  // ── AC3 · Standard server-side pagination ─────────────────────────────────

  test("#77-3 · page-size selector shows 10/25/50 (default 10) and resets to page 1", async ({
    page,
    request,
  }) => {
    const tag = `I77G${Date.now()}`;
    const token = await loginAsDemoApi(request);
    await seedClientBatch(request, token, tag);

    await gotoClients(page);

    const select = page.getByLabel("Rows per page:");
    await expect(select).toBeVisible({ timeout: 10_000 });
    await expect(select).toHaveValue("10");
    const options = select.locator("option");
    await expect(options).toHaveCount(3);
    await expect(options.nth(0)).toHaveText("10");
    await expect(options.nth(1)).toHaveText("25");
    await expect(options.nth(2)).toHaveText("50");

    await searchClients(page, tag);
    await expect(page.getByText(/1–10 of 12/)).toBeVisible({ timeout: 10_000 });

    const prevBtn = page.getByRole("button", { name: /previous/i });
    const nextBtn = page.getByRole("button", { name: /next/i });
    await expect(prevBtn).toBeDisabled();
    await expect(nextBtn).toBeEnabled();

    await nextBtn.click();
    await page.waitForTimeout(600);
    await expect(prevBtn).toBeEnabled();

    // Changing page size resets to page 1 and shows all 12 seeded clients.
    await select.selectOption("25");
    await page.waitForTimeout(600);
    await expect(page.getByText(/1–12 of 12/)).toBeVisible({ timeout: 10_000 });
  });

  // ── AC4 · CSV export is global for the current filters ────────────────────

  test("#77-4 · CSV export includes matching clients from every page", async ({
    page,
    request,
  }) => {
    const tag = `I77E${Date.now()}`;
    const token = await loginAsDemoApi(request);
    const { firstId, targetName } = await seedClientBatch(request, token, tag);
    await apiPostJson(request, token, `/api/clients/${firstId}/deactivate`, {});

    await gotoClients(page);
    await searchClients(page, tag);
    await page.getByRole("button", { name: "Active", exact: true }).click();
    await page.waitForTimeout(600);
    await expect(page.getByText(/1–10 of 11/)).toBeVisible({ timeout: 10_000 });

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const download = await downloadPromise;
    const path = await download.path();
    const fs = await import("node:fs/promises");
    const csv = await fs.readFile(path, "utf-8");

    // Page-2 client is exported; the deactivated (filtered-out) one is not.
    expect(csv).toContain(targetName);
    expect(csv).not.toContain(`${tag} A00`);
    const dataRows = csv.split("\n").filter((line) => line.includes(tag));
    expect(dataRows).toHaveLength(11);
  });
});

// ── AC5 · Services + billing history regression ─────────────────────────────

test.describe("Issue #77 · Services and billing history searches are global", () => {
  test("#77-5a · services search matches a service beyond page 1", async ({ page, request }) => {
    const tag = `I77V${Date.now()}`;
    const token = await loginAsDemoApi(request);
    const cat = await apiPostJson<{ id: number }>(request, token, "/api/service-categories", {
      name: `I77 Cat ${Date.now()}`,
      accentKey: "rose",
    });
    for (let i = 0; i < 10; i++) {
      await apiPostJson(request, token, "/api/services", {
        name: `${tag} A${String(i).padStart(2, "0")}`,
        categoryId: cat.id,
        priceMinor: 5000,
        durationMinutes: 30,
      });
    }
    const targetName = `${tag} Z Unique`;
    await apiPostJson(request, token, "/api/services", {
      name: targetName,
      categoryId: cat.id,
      priceMinor: 5000,
      durationMinutes: 30,
    });

    await loginAsDemo(page);
    await page.goto("/app/services");
    await page.waitForTimeout(600);

    await page.getByPlaceholder(/search by name/i).fill(tag);
    await page.waitForTimeout(600);
    await expect(page.getByText(/1–10 of 11/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(targetName, { exact: true })).toHaveCount(0);

    await page.getByPlaceholder(/search by name/i).fill(`${tag} Z`);
    await page.waitForTimeout(600);
    await expect(page.getByText(targetName, { exact: true })).toBeVisible();
  });

  test("#77-5b · billing history search finds an invoice beyond page 1", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const tag = `I77B${Date.now()}`;
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    const cat = await apiPostJson<{ id: number }>(request, token, "/api/service-categories", {
      name: `I77B Cat ${Date.now()}`,
      accentKey: "rose",
    });
    const svc = await apiPostJson<{ id: number }>(request, token, "/api/services", {
      name: `I77B Svc ${Date.now()}`,
      categoryId: cat.id,
      priceMinor: 5000,
      durationMinutes: 30,
    });
    const clientName = `${tag} Cliente Factura`;
    const client = await seedClient(request, token, clientName);

    const issueInvoice = (clientId: number | null, clientDisplayName: string | null) =>
      apiPostJson(request, token, "/api/invoices", {
        clientId,
        clientDisplayName,
        clientRucOverride: null,
        discountType: null,
        discountValue: null,
        lines: [
          {
            serviceId: svc.id,
            description: "Servicio test",
            quantity: 1,
            unitPrice: 5000,
            discountType: null,
            discountValue: null,
          },
        ],
        payments: [{ method: "CASH", amount: 5000 }],
      });

    // Target invoice first, then 11 newer ones → target lands beyond page 1
    // (history is ordered by issue date, newest first). The history text search matches against
    // clientDisplayName (Issue #96: a selected client's display name is never auto-filled from
    // their profile), so it must be set explicitly here for the by-name search to find it.
    await issueInvoice(client.id, clientName);
    for (let i = 0; i < 11; i++) {
      await issueInvoice(null, "CONSUMIDOR FINAL");
    }

    await loginAsDemo(page);
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "History" }).click();
    await page.waitForTimeout(600);
    await expect(page.getByText(clientName, { exact: true })).toHaveCount(0);

    await page.locator("#invoice-history-text-filter").fill(clientName);
    await page.waitForTimeout(600);
    await expect(page.getByText(clientName, { exact: true }).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("#77-5c · billing history search by invoice number finds an invoice beyond page 1", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const tag = `I77N${Date.now()}`;
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    const cat = await apiPostJson<{ id: number }>(request, token, "/api/service-categories", {
      name: `I77N Cat ${Date.now()}`,
      accentKey: "rose",
    });
    const svc = await apiPostJson<{ id: number }>(request, token, "/api/services", {
      name: `I77N Svc ${Date.now()}`,
      categoryId: cat.id,
      priceMinor: 5000,
      durationMinutes: 30,
    });
    const clientName = `${tag} Cliente`;
    const client = await seedClient(request, token, clientName);

    const issueInvoice = (clientId: number | null) =>
      apiPostJson<{ id: number; invoiceNumberFormatted: string }>(
        request,
        token,
        "/api/invoices",
        {
          clientId,
          clientDisplayName: clientId === null ? "CONSUMIDOR FINAL" : null,
          clientRucOverride: null,
          discountType: null,
          discountValue: null,
          lines: [
            {
              serviceId: svc.id,
              description: "Servicio test",
              quantity: 1,
              unitPrice: 5000,
              discountType: null,
              discountValue: null,
            },
          ],
          payments: [{ method: "CASH", amount: 5000 }],
        },
      );

    // Target invoice first, then 11 newer ones → target lands beyond page 1.
    const target = await issueInvoice(client.id);
    for (let i = 0; i < 11; i++) {
      await issueInvoice(null);
    }

    await loginAsDemo(page);
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "History" }).click();
    await page.waitForTimeout(600);
    await expect(page.getByText(target.invoiceNumberFormatted, { exact: true })).toHaveCount(0);

    // Full zero-padded number (as displayed) must find the invoice via exact match.
    await page.locator("#invoice-history-text-filter").fill(target.invoiceNumberFormatted);
    await page.waitForTimeout(600);
    await expect(
      page.getByText(target.invoiceNumberFormatted, { exact: true }).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Unpadded digits (as a user would naturally type them) must also match.
    const unpadded = String(Number(target.invoiceNumberFormatted));
    await page.locator("#invoice-history-text-filter").fill(unpadded);
    await page.waitForTimeout(600);
    await expect(
      page.getByText(target.invoiceNumberFormatted, { exact: true }).first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});
