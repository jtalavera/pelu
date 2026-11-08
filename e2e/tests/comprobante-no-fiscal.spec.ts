import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  API_BASE,
  apiGetJson,
  apiPostJson,
  apiPutJson,
  authHeaders,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  listFiscalStamps,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  setTenantFeatureFlag,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { ensureCashSessionOpen, fillPaymentAmount, goToBillingHome, goToInvoiceHistory } from "../fixtures/billing";
import {
  clickIssueInvoiceAndExpectSuccess,
  expectedInvoiceFilename,
  pdfContainsText,
  pickServiceLine,
} from "../fixtures/invoice";

/**
 * Comprobante NO fiscal (tier Estándar, sin SIFEN): cuando SIFEN no está activo, el comprobante es un documento
 * propio del negocio, parecido al KuDE pero sin valor fiscal, en hoja A4 o ticket de 80 mm a elegir al descargar.
 * Reemplaza al comprobante preimpreso (formulario continuo) y usa el logo del negocio.
 * Ver requirements/user_stories/HU-71-comprobante-no-fiscal.md.
 */
test.describe.configure({ mode: "serial" });

const DEMO_TENANT_ID = 1;
const FLAG = "NON_FISCAL_RECEIPT";
/** A 1×1 PNG, enough to prove the logo reaches the PDF. */
const LOGO_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function setProfile(request: APIRequestContext, token: string, logoDataUrl: string | null, ruc: string | null) {
  await apiPutJson(request, token, "/api/business-profile", {
    businessName: "Salón E2E Demo",
    ruc,
    address: "Av. Mariscal López 1234, Asunción",
    phone: "0981 555 000",
    contactEmail: null,
    logoDataUrl,
  });
}

type Issued = { id: number; invoiceNumberFormatted: string };

/** Issues an invoice by API: a 10 % service plus a 5 % one, a global discount, two payments and a tip. */
async function issueRichInvoice(request: APIRequestContext, token: string): Promise<Issued> {
  const taxes = await apiGetJson<{ id: number; rate: number; active: boolean }[]>(request, token, "/api/taxes");
  const tax10 = taxes.find((t) => t.active && t.rate === 10)!;
  const tax5 = taxes.find((t) => t.active && t.rate === 5)!;
  const suffix = Date.now();
  const cat = await apiPostJson<{ id: number }>(request, token, "/api/service-categories", {
    name: `E2E NF Cat ${suffix}`,
    accentKey: "stone",
  });
  const svc10 = await apiPostJson<{ id: number }>(request, token, "/api/services", {
    name: `E2E NF Iva10 ${suffix}`,
    categoryId: cat.id,
    taxId: tax10.id,
    priceMinor: 88000,
    durationMinutes: 30,
  });
  const svc5 = await apiPostJson<{ id: number }>(request, token, "/api/services", {
    name: `E2E NF Iva5 ${suffix}`,
    categoryId: cat.id,
    taxId: tax5.id,
    priceMinor: 42000,
    durationMinutes: 30,
  });
  // Subtotal 130.000, 10 % global discount (13.000) -> total 117.000: IVA 10 % = 7.200, IVA 5 % = 1.800.
  return apiPostJson<Issued>(request, token, "/api/invoices", {
    clientId: null,
    clientDisplayName: `E2E NF ${suffix}`,
    clientRucOverride: "3456789-1",
    discountType: "PERCENT",
    discountValue: 10,
    lines: [
      { serviceId: svc10.id, description: "E2E NF Iva10", quantity: 1, unitPrice: 88000 },
      { serviceId: svc5.id, description: "E2E NF Iva5", quantity: 1, unitPrice: 42000 },
    ],
    payments: [
      { method: "CASH", amount: 100000 },
      { method: "TRANSFER", amount: 17000 },
    ],
    tipsAmount: 0,
  });
}

async function fetchPdf(
  request: APIRequestContext,
  token: string,
  id: number,
  format?: "A4" | "TICKET",
): Promise<{ buf: Buffer; disposition: string; status: number; contentType: string }> {
  const res = await request.get(`${API_BASE}/api/invoices/${id}/pdf${format ? `?format=${format}` : ""}`, {
    headers: authHeaders(token),
  });
  return {
    buf: Buffer.from(await res.body()),
    disposition: res.headers()["content-disposition"] ?? "",
    status: res.status(),
    contentType: res.headers()["content-type"] ?? "",
  };
}

/** The filename the backend proposes: date in the business zone + «001-001-0000123» (stamp's establishment-point). */
async function expectedFilename(
  request: APIRequestContext,
  token: string,
  id: number,
  invoiceNumberFormatted: string,
  format: "A4" | "TICKET" = "A4",
): Promise<string> {
  const detail = await apiGetJson<{ issuedAt: string; fiscalStampNumber: string }>(request, token, `/api/invoices/${id}`);
  const stamp = (await listFiscalStamps(request, token)).find((s) => s.stampNumber === detail.fiscalStampNumber)!;
  const number = `${String(stamp.establishment).padStart(3, "0")}-${String(stamp.expeditionPoint).padStart(3, "0")}-${invoiceNumberFormatted}`;
  return expectedInvoiceFilename(detail.issuedAt, number, format);
}

test.describe("Comprobante no fiscal", () => {
  test.beforeEach(async ({ request }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    await setProfile(request, token, null, "80000005-6");
  });

  test("AC-2/AC-4/AC-5 · la hoja A4 dice que no es fiscal, discrimina el IVA y no trae datos fiscales", async ({ request }) => {
    const token = await loginAsDemoApi(request);
    const inv = await issueRichInvoice(request, token);
    const { buf, status, contentType, disposition } = await fetchPdf(request, token, inv.id);

    expect(status).toBe(200);
    expect(contentType).toContain("application/pdf");
    expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(disposition).toContain(await expectedFilename(request, token, inv.id, inv.invoiceNumberFormatted));

    // Says it has no fiscal value, in the title, the banner and the watermark.
    expect(pdfContainsText(buf, "COMPROBANTE")).toBe(true);
    expect(pdfContainsText(buf, "NO FISCAL")).toBe(true);
    expect(pdfContainsText(buf, "DOCUMENTO SIN VALOR FISCAL · NO ES UNA FACTURA")).toBe(true);
    expect(pdfContainsText(buf, "SIN VALOR FISCAL")).toBe(true);
    // The business, the sale and the number that still comes from the stamp's sequence.
    expect(pdfContainsText(buf, "Salón E2E Demo")).toBe(true);
    expect(pdfContainsText(buf, "RUC 80000005-6")).toBe(true);
    expect(pdfContainsText(buf, "Contado")).toBe(true);
    expect(pdfContainsText(buf, "3456789-1")).toBe(true);
    const stamp = (await listFiscalStamps(request, token)).find((s) => s.active)!;
    expect(pdfContainsText(buf, `N.º ${String(stamp.establishment).padStart(3, "0")}-${String(stamp.expeditionPoint).padStart(3, "0")}-${inv.invoiceNumberFormatted}`)).toBe(true);
    // Totals, the amount in words and the IVA breakdown by rate (7.200 + 1.800 = 9.000).
    expect(pdfContainsText(buf, "117.000")).toBe(true);
    expect(pdfContainsText(buf, "Son: ciento diecisiete mil guaraníes")).toBe(true);
    expect(pdfContainsText(buf, "Exentas")).toBe(true);
    expect(pdfContainsText(buf, "Liquidación del IVA (incluido en el total)")).toBe(true);
    expect(pdfContainsText(buf, "7.200")).toBe(true);
    expect(pdfContainsText(buf, "1.800")).toBe(true);
    expect(pdfContainsText(buf, "9.000")).toBe(true);
    // Each payment with its label.
    expect(pdfContainsText(buf, "Efectivo")).toBe(true);
    expect(pdfContainsText(buf, "Transferencia")).toBe(true);
    // No fiscal data: not the timbrado, nor its validity, nor the pre-printed form's copy labels.
    for (const forbidden of ["Timbrado", "Vigencia", "CDC", "COPIA: ARCHIVO TRIBUTARIO", "ORIGINAL: ADQUIRENTE"]) {
      expect(buf.toString("latin1")).not.toContain(forbidden);
      expect(pdfContainsText(buf, forbidden)).toBe(false);
    }
    expect(pdfContainsText(buf, stamp.stampNumber)).toBe(false);
  });

  test("AC-3 · el ticket de 80 mm lleva lo mismo en una columna angosta y su nombre termina en -TICKET", async ({ request }) => {
    const token = await loginAsDemoApi(request);
    const inv = await issueRichInvoice(request, token);
    const { buf, status, disposition } = await fetchPdf(request, token, inv.id, "TICKET");

    expect(status).toBe(200);
    expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(disposition).toContain(await expectedFilename(request, token, inv.id, inv.invoiceNumberFormatted, "TICKET"));
    // The page is 80 mm wide (226.77 pt), not an A4 sheet (595 pt).
    expect(buf.toString("latin1")).toMatch(/\/MediaBox\s*\[\s*0\s+0\s+226\.7\d*\s+\d+/);
    expect(pdfContainsText(buf, "COMPROBANTE NO FISCAL")).toBe(true);
    expect(pdfContainsText(buf, "SIN VALOR FISCAL")).toBe(true);
    expect(pdfContainsText(buf, "SALÓN E2E DEMO")).toBe(true);
    expect(pdfContainsText(buf, "TOTAL Gs.")).toBe(true);
    expect(pdfContainsText(buf, "117.000")).toBe(true);
    expect(pdfContainsText(buf, "7.200")).toBe(true);
    expect(pdfContainsText(buf, "1.800")).toBe(true);
    expect(pdfContainsText(buf, "Total IVA")).toBe(true);
    expect(pdfContainsText(buf, "Timbrado")).toBe(false);
  });

  test("AC-6 · el logo del negocio aparece en el A4 y en el ticket; sin logo, no hay imagen", async ({ request }) => {
    const token = await loginAsDemoApi(request);
    const inv = await issueRichInvoice(request, token);
    const hasImage = (buf: Buffer) => /\/Subtype\s*\/Image/.test(buf.toString("latin1"));

    for (const format of ["A4", "TICKET"] as const) {
      expect(hasImage((await fetchPdf(request, token, inv.id, format)).buf), `sin logo ${format}`).toBe(false);
    }
    await setProfile(request, token, LOGO_DATA_URL, "80000005-6");
    for (const format of ["A4", "TICKET"] as const) {
      expect(hasImage((await fetchPdf(request, token, inv.id, format)).buf), `con logo ${format}`).toBe(true);
    }
    // A broken logo never blocks the receipt.
    await setProfile(request, token, "data:image/png;base64,@@@", "80000005-6");
    expect((await fetchPdf(request, token, inv.id)).status).toBe(200);
  });

  test("AC-9 · ya no hace falta el RUC del negocio para descargar el comprobante", async ({ request }) => {
    const token = await loginAsDemoApi(request);
    const inv = await issueRichInvoice(request, token);
    await setProfile(request, token, null, null);
    const { status, buf } = await fetchPdf(request, token, inv.id);
    expect(status).toBe(200);
    expect(pdfContainsText(buf, "COMPROBANTE")).toBe(true);
    expect(pdfContainsText(buf, "RUC 80000005-6")).toBe(false);
  });

  test("AC-11/AC-12 · un formato desconocido se rechaza y «Sin nombre» no revela datos de la clienta", async ({ request }) => {
    const token = await loginAsDemoApi(request);
    const inv = await issueRichInvoice(request, token);
    const bad = await request.get(`${API_BASE}/api/invoices/${inv.id}/pdf?format=A3`, { headers: authHeaders(token) });
    expect(bad.status()).toBe(400);
    expect(await bad.text()).toContain("RECEIPT_FORMAT_INVALID");

    const client = await apiPostJson<{ id: number }>(request, token, "/api/clients", {
      fullName: `E2E NF Cliente ${Date.now()}`,
      phone: null,
      email: null,
      ruc: "4567890-1",
    });
    const seed = await seedCategoryServiceProfessional(request, token);
    const anon = await apiPostJson<Issued>(request, token, "/api/invoices", {
      clientId: client.id,
      clientDisplayName: null,
      clientRucOverride: null,
      lines: [{ serviceId: seed.serviceId, description: "E2E NF sin nombre", quantity: 1, unitPrice: 9000 }],
      payments: [{ method: "CASH", amount: 9000 }],
    });
    const { buf } = await fetchPdf(request, token, anon.id);
    expect(pdfContainsText(buf, "Sin nombre")).toBe(true);
    expect(buf.toString("latin1")).not.toContain("4567890-1");
  });

  test("AC-1 · al emitir, «Descargar comprobante» ofrece A4 y ticket y descarga el elegido", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    await loginAsDemo(page);
    await ensureCashSessionOpen(page);

    await goToBillingHome(page);
    await page.getByRole("button", { name: "New Invoice" }).click();
    await page.getByLabel("Search or select client").click();
    await page.getByRole("button", { name: "Occasional client" }).click();
    await page.getByLabel("Client name / business name").fill("E2E NF UI");
    await pickServiceLine(page, seed.serviceFullName, 0);
    await page.locator("#line-price-0").fill("9000");
    await fillPaymentAmount(page, "9000");
    const issued = await clickIssueInvoiceAndExpectSuccess(page);

    // One button; the formats show up when downloading, not before.
    const download = page.getByTestId("billing-success-download-pdf");
    await expect(download).toHaveText(/Download receipt/, { timeout: 10_000 });
    await expect(page.getByRole("button", { name: "Download PDF" })).toHaveCount(0);
    await expect(page.getByTestId("billing-success-download-pdf-formats")).toHaveCount(0);
    await download.click();
    await expect(page.getByTestId("billing-success-download-pdf-a4")).toContainText("A4 sheet");
    await expect(page.getByTestId("billing-success-download-pdf-ticket")).toContainText("80 mm ticket");

    const [a4] = await Promise.all([
      page.waitForEvent("download", { timeout: 20_000 }),
      page.getByTestId("billing-success-download-pdf-a4").click(),
    ]);
    expect(a4.suggestedFilename()).toBe(await expectedFilename(request, token, issued.id, issued.invoiceNumberFormatted));
    const fs = await import("fs/promises");
    expect((await fs.readFile((await a4.path())!)).subarray(0, 4).toString("latin1")).toBe("%PDF");

    // The options folded back; the ticket is the second choice.
    await expect(page.getByTestId("billing-success-download-pdf-formats")).toHaveCount(0);
    await download.click();
    const [ticket] = await Promise.all([
      page.waitForEvent("download", { timeout: 20_000 }),
      page.getByTestId("billing-success-download-pdf-ticket").click(),
    ]);
    expect(ticket.suggestedFilename()).toBe(
      await expectedFilename(request, token, issued.id, issued.invoiceNumberFormatted, "TICKET"),
    );
    await expect(page.getByRole("alert").filter({ hasText: "RUC" })).not.toBeVisible();
  });

  test("AC-1 · el detalle del comprobante marca «Sin valor fiscal» y ofrece los dos formatos", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const inv = await issueRichInvoice(request, token);
    await loginAsDemo(page);
    await page.goto("/app/billing");
    await goToInvoiceHistory(page);

    const row = page
      .locator('[data-testid^="invoice-history-row-"]')
      .filter({ hasText: inv.invoiceNumberFormatted })
      .filter({ visible: true });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();
    const dialog = page.getByRole("dialog").filter({ hasText: inv.invoiceNumberFormatted });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByTestId("invoice-non-fiscal-badge")).toHaveText("No fiscal value");
    await expect(dialog.getByRole("button", { name: "Download PDF" })).toHaveCount(0);

    await dialog.getByTestId("invoice-download-pdf-button").click();
    const [ticket] = await Promise.all([
      page.waitForEvent("download", { timeout: 20_000 }),
      dialog.getByTestId("invoice-download-pdf-button-ticket").click(),
    ]);
    expect(ticket.suggestedFilename()).toBe(
      await expectedFilename(request, token, inv.id, inv.invoiceNumberFormatted, "TICKET"),
    );
    await dialog.getByTestId("invoice-download-pdf-button").click();
    const [a4] = await Promise.all([
      page.waitForEvent("download", { timeout: 20_000 }),
      dialog.getByTestId("invoice-download-pdf-button-a4").click(),
    ]);
    expect(a4.suggestedFilename()).toBe(await expectedFilename(request, token, inv.id, inv.invoiceNumberFormatted));
  });

  test("AC-7 · es una función del tier: apagada, no se ofrece y el PDF responde 409", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const inv = await issueRichInvoice(request, token);
    try {
      await setTenantFeatureFlag(request, DEMO_TENANT_ID, FLAG, false);
      const res = await request.get(`${API_BASE}/api/invoices/${inv.id}/pdf`, { headers: authHeaders(token) });
      expect(res.status()).toBe(409);
      expect(await res.text()).toContain("NON_FISCAL_RECEIPT_NOT_ENABLED");

      await loginAsDemo(page);
      await page.goto("/app/billing");
      await goToInvoiceHistory(page);
      const row = page
        .locator('[data-testid^="invoice-history-row-"]')
        .filter({ hasText: inv.invoiceNumberFormatted })
        .filter({ visible: true });
      await expect(row).toBeVisible({ timeout: 15_000 });
      await row.click();
      const dialog = page.getByRole("dialog").filter({ hasText: inv.invoiceNumberFormatted });
      await expect(dialog.getByTestId("invoice-status-badge")).toBeVisible({ timeout: 10_000 });
      await expect(dialog.getByTestId("invoice-download-pdf-button")).toHaveCount(0);
      await expect(dialog.getByTestId("invoice-non-fiscal-badge")).toHaveCount(0);
    } finally {
      await setTenantFeatureFlag(request, DEMO_TENANT_ID, FLAG, true);
    }
    // Back on: the receipt is served again.
    expect((await fetchPdf(request, token, inv.id)).status).toBe(200);
  });

  test("AC-8 · con SIFEN activo no cambia nada: el comprobante no fiscal no se ofrece (queda el KuDE)", async ({ request }) => {
    const token = await loginAsDemoApi(request);
    const inv = await issueRichInvoice(request, token);
    try {
      await setTenantFeatureFlag(request, DEMO_TENANT_ID, "SIFEN_ELECTRONIC_INVOICING", true);
      const res = await request.get(`${API_BASE}/api/invoices/${inv.id}/pdf`, { headers: authHeaders(token) });
      expect(res.status()).toBe(409);
      expect(await res.text()).toContain("SIFEN_LEGACY_PDF_DISABLED");
    } finally {
      await setTenantFeatureFlag(request, DEMO_TENANT_ID, "SIFEN_ELECTRONIC_INVOICING", false);
    }
  });

  test("AC-10 · un comprobante anulado no genera comprobante", async ({ request }) => {
    const token = await loginAsDemoApi(request);
    const inv = await issueRichInvoice(request, token);
    const voided = await request.post(`${API_BASE}/api/invoices/${inv.id}/void`, {
      headers: authHeaders(token),
      data: { voidReason: "E2E anulación" },
    });
    expect(voided.ok(), await voided.text()).toBeTruthy();
    const res = await request.get(`${API_BASE}/api/invoices/${inv.id}/pdf`, { headers: authHeaders(token) });
    expect(res.status()).toBe(400);
    expect(await res.text()).toContain("INVOICE_PDF_ONLY_FOR_ISSUED");
  });
});
