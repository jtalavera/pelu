import zlib from "node:zlib";
import { expect, type Page } from "@playwright/test";

/**
 * Selects a service in the billing-line service search field for the given line index.
 * Fills the combobox with a partial name, then clicks the matching dropdown button.
 */
export async function pickServiceLine(
  page: Page,
  serviceFullName: string,
  lineIdx = 0,
): Promise<void> {
  await page.locator(`#billing-line-svc-${lineIdx}`).fill(serviceFullName.slice(0, 12));
  // exact: false → substring match; avoids dynamic RegExp construction flagged by semgrep
  await page.getByRole("button", { name: serviceFullName, exact: false }).click();
}

/**
 * Waits for POST /api/invoices success and the success alert (title "Invoice issued").
 * Returns the created invoice's id and formatted number from the response body.
 */
export async function clickIssueInvoiceAndExpectSuccess(
  page: Page,
): Promise<{ id: number; invoiceNumberFormatted: string }> {
  const [res] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes("/api/invoices") &&
        r.request().method() === "POST" &&
        !r.url().includes("/void") &&
        !r.url().includes("/pdf"),
      { timeout: 30_000 },
    ),
    page.getByRole("button", { name: "Issue invoice" }).click(),
  ]);
  expect(res.ok(), await res.text()).toBeTruthy();
  await expect(page.getByRole("alert").filter({ hasText: "Invoice issued" })).toBeVisible({
    timeout: 15_000,
  });
  return res.json();
}

/**
 * Expected invoice PDF filename per issue #84: FACTURA-<yyyymmdd>-<timbrado>-<numero>.pdf, where
 * the date is the emission date rendered in the business timezone (America/Asuncion).
 */
export function expectedInvoiceFilename(
  issuedAtIso: string,
  fiscalStampNumber: string,
  invoiceNumberFormatted: string,
): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Asuncion",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(issuedAtIso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `FACTURA-${get("year")}${get("month")}${get("day")}-${fiscalStampNumber}-${invoiceNumberFormatted}.pdf`;
}

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
export function pdfContainsText(pdf: Buffer, searchText: string): boolean {
  const stream = decodePdfContentStream(pdf);
  const escaped = searchText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\(${escaped}\\)Tj`).test(stream);
}
