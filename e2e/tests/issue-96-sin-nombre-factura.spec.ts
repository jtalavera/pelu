import zlib from "node:zlib";
import { expect, test } from "@playwright/test";
import {
  apiBaseUrl,
  apiPostJson,
  apiPutJson,
  authHeaders,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { ensureCashSessionOpen } from "../fixtures/billing";
import { clickIssueInvoiceAndExpectSuccess, pickServiceLine } from "../fixtures/invoice";

/**
 * Decompresses the first FlateDecode content stream in a PDF and returns its raw operator text
 * (mirrors `InvoicePdfServiceTest.decodePdfContentStream` on the backend).
 */
function decodePdfContentStream(pdf: Buffer): string {
  const lf = Buffer.from("stream\n", "ascii");
  const crlf = Buffer.from("stream\r\n", "ascii");
  let start = pdf.indexOf(lf);
  let headerLen = lf.length;
  if (start < 0) {
    start = pdf.indexOf(crlf);
    headerLen = crlf.length;
  }
  if (start < 0) throw new Error("No stream marker found in PDF");
  const contentStart = start + headerLen;
  const end = Buffer.from("endstream", "ascii");
  const contentEnd = pdf.indexOf(end, contentStart);
  if (contentEnd < 0) throw new Error("No endstream marker found in PDF");
  const compressed = pdf.subarray(contentStart, contentEnd);
  return zlib.inflateSync(compressed).toString("latin1");
}

/** `true` when `searchText` is drawn as a `(searchText)Tj` operator in the PDF's first content stream. */
function pdfContainsText(pdf: Buffer, searchText: string): boolean {
  const stream = decodePdfContentStream(pdf);
  const escaped = searchText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\(${escaped}\\)Tj`).test(stream);
}

async function setBusinessRuc(request: import("@playwright/test").APIRequestContext, token: string) {
  await apiPutJson(request, token, "/api/business-profile", {
    businessName: "Demo salon",
    ruc: "80000005-6",
    address: null,
    phone: null,
    contactEmail: null,
    logoDataUrl: null,
  });
}

async function fetchInvoicePdf(
  request: import("@playwright/test").APIRequestContext,
  token: string,
  invoiceId: number,
): Promise<Buffer> {
  const res = await request.get(`${apiBaseUrl()}/api/invoices/${invoiceId}/pdf`, {
    headers: authHeaders(token),
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return Buffer.from(await res.body());
}

test.describe("Issue #96 · 'Sin nombre' cuando no se solicita factura con RUC", () => {
  test("cliente seleccionado con nombre y RUC en blanco imprime 'Sin nombre' y RUC vacío", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await setBusinessRuc(request, token);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);

    // Client has a real profile name + RUC — both must NOT leak into the PDF once cleared.
    const clientRuc = "80000005-6";
    const client = await apiPostJson<{ id: number; fullName: string }>(
      request,
      token,
      "/api/clients",
      {
        fullName: `E2E Issue96 ${Date.now()}`,
        phone: null,
        email: null,
        ruc: clientRuc,
      },
    );

    await loginAsDemo(page);
    await ensureCashSessionOpen(page);
    await page.getByRole("tab", { name: "New Invoice" }).click();
    await page.getByLabel("Search or select client").fill(client.fullName.slice(0, 8));
    await page.getByRole("button", { name: client.fullName }).click();

    // Selecting the client auto-fills both fields — clear them to test the blank scenario.
    await expect(page.locator("#client-display-name")).toHaveValue(client.fullName);
    await expect(page.locator("#client-ruc")).toHaveValue(clientRuc);
    await page.locator("#client-display-name").fill("");
    await page.locator("#client-ruc").fill("");

    await pickServiceLine(page, seed.serviceFullName, 0);
    await page.locator("#line-price-0").fill("9000");
    await page.locator("#pay-amount-0").fill("9000");
    const issued = await clickIssueInvoiceAndExpectSuccess(page);

    const pdf = await fetchInvoicePdf(request, token, issued.id);
    expect(pdfContainsText(pdf, "Sin nombre")).toBe(true);
    expect(pdfContainsText(pdf, clientRuc)).toBe(false);
    expect(pdfContainsText(pdf, client.fullName)).toBe(false);
  });
});
