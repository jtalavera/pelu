import { expect, test, type Page } from "@playwright/test";

import {
  apiBaseUrl,
  apiPostJson,
  authHeaders,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { ensureCashSessionOpen } from "../fixtures/billing";
import { pickServiceLine } from "../fixtures/invoice";

// Issue #181 "Cambios en factura electrónica Parte 2 - CORRECCIÓN 2":
//  1. The helper comments under the comprobante-form fields (issue date, email, first payment
//     "Monto", tax-exempt note) must share the "look and feel" of the muted text shown under the
//     client search when a client is selected — i.e. `<Text variant="muted">` → text-sm /
//     text-slate-500. Two of them also get new copy.
//  2. Optimise the first Historial report download (a startup warm-up + a header-only projection
//     query). The observable, non-flaky part: the report still downloads correctly.

async function openNewInvoiceForm(page: Page) {
  await page.goto("/app/billing");
  await ensureCashSessionOpen(page);
  await page.getByRole("tab", { name: "Cash Register" }).click();
  await page.getByRole("button", { name: "New Invoice" }).click();
}

test.describe("Issue #181 · form hints + report", () => {
  test("item 1 · form helper comments match the muted look & feel and carry the new copy", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);

    await loginAsDemo(page);
    await openNewInvoiceForm(page);

    // The reference: the muted text under the client search once a client is selected.
    await page.getByLabel("Search or select client").click();
    await page.getByRole("button", { name: "Occasional client" }).click();
    await page.getByLabel("Client name / business name").fill("HINTS 181");
    await pickServiceLine(page, seed.serviceFullName, 0);
    await page.locator("#line-price-0").fill("40000");

    // Issue-date legend: new copy + muted styling.
    const legend = page.getByText(
      "The document may be dated up to 30 days in the past or 5 days in the future relative to its submission to SIFEN.",
    );
    await expect(legend).toBeVisible();
    await expect(legend).toHaveClass(/text-slate-500/);
    await expect(legend).toHaveClass(/text-sm/);

    // Email hint: muted styling.
    const emailHint = page.locator("#billing-client-email-hint");
    await expect(emailHint).toBeVisible();
    await expect(emailHint).toHaveClass(/text-slate-500/);
    await expect(emailHint).toHaveClass(/text-sm/);

    // First payment "Monto" hint: new copy + muted styling.
    const payHint = page.locator("#pay-amount-0-hint");
    await expect(payHint).toHaveText(
      "This field is auto-filled with the total, but you can edit it for partial payments",
    );
    await expect(payHint).toHaveClass(/text-slate-500/);
    await expect(payHint).toHaveClass(/text-sm/);

    // Tax-exempt note (a diplomatic receiver): muted styling.
    await page.locator("#client-identity-document-type").selectOption("TARJETA_DIPLOMATICA");
    await page.locator("#client-identity-document-number").fill("DIP-181");
    const taxNote = page.getByTestId("billing-tax-exempt-note");
    await expect(taxNote).toBeVisible();
    await expect(taxNote).toHaveClass(/text-slate-500/);
    await expect(taxNote).toHaveClass(/text-sm/);
  });

  test("item 2 · the Historial report endpoint still serves a valid Excel and PDF after the refactor", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);

    const clientName = `E2E 181 REPORTE ${Date.now()}`;
    const client = await seedClient(request, token, clientName);
    await apiPostJson(request, token, "/api/invoices", {
      clientId: client.id,
      clientDisplayName: "OTRO NOMBRE EN LA FACTURA",
      email: null,
      lines: [
        { serviceId: seed.serviceId, description: seed.serviceFullName, quantity: 1, unitPrice: 30000 },
      ],
      payments: [{ method: "CASH", amount: 30000 }],
    });

    // The header-only projection query runs end-to-end for both formats.
    const q = "q=OTRO+NOMBRE+EN+LA+FACTURA";
    const pdf = await request.get(`${apiBaseUrl()}/api/invoices/report?format=pdf&${q}`, {
      headers: authHeaders(token),
    });
    expect(pdf.ok(), await pdf.text()).toBeTruthy();
    expect(pdf.headers()["content-type"]).toContain("application/pdf");
    expect(pdf.headers()["content-disposition"]).toMatch(/COMPROBANTES-.*\.pdf/);
    expect(Buffer.from(await pdf.body()).subarray(0, 4).toString("latin1")).toBe("%PDF");

    const xlsx = await request.get(`${apiBaseUrl()}/api/invoices/report?format=xlsx&${q}`, {
      headers: authHeaders(token),
    });
    expect(xlsx.ok(), await xlsx.text()).toBeTruthy();
    expect(xlsx.headers()["content-type"]).toContain("spreadsheetml.sheet");
    expect(Buffer.from(await xlsx.body()).subarray(0, 2).toString("latin1")).toBe("PK");

    // And the "Descargar reporte" dropdown still triggers a browser download.
    await loginAsDemo(page);
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "History" }).click();
    await page.getByTestId("invoice-history-report-button").click();
    const [dl] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("invoice-history-report-xlsx").click(),
    ]);
    expect(dl.suggestedFilename()).toMatch(/^COMPROBANTES-.*\.xlsx$/);
  });
});
