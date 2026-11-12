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
  const option = page.getByRole("button", { name: serviceFullName, exact: false });
  await option.click();
  // Wait for the option list to close, so the next line's pick never sees this line's stale list
  // (two matching buttons → strict-mode violation). Best effort: never fails the pick itself.
  await expect(option)
    .toHaveCount(0, { timeout: 3_000 })
    .catch(() => undefined);
}

/**
 * Issue #284: no payment method is preselected in "New invoice" so the user has to choose it.
 * Chooses `label` (default "Cash") when the payment is still undecided — specs that don't care
 * about the method call this before issuing. A single payment is picked with the method buttons;
 * a split payment has one select per row, and every row that is still empty gets `label`.
 */
export async function ensurePaymentMethodChosen(page: Page, label = "Cash"): Promise<void> {
  const selects = page.locator('select[id^="pay-method-"]');
  const count = await selects.count();
  if (count === 0) {
    const pressed = page.locator('button[id^="pay-method-"][aria-pressed="true"]');
    if ((await pressed.count()) === 0) {
      await page.getByRole("group", { name: "Method" }).getByRole("button", { name: label, exact: true }).click();
    }
    return;
  }
  for (let i = 0; i < count; i++) {
    const select = selects.nth(i);
    if ((await select.inputValue()) === "") {
      await select.selectOption({ label });
    }
  }
}

/**
 * Waits for POST /api/invoices success and the success alert (title "Invoice issued").
 * Returns the created invoice's id and formatted number from the response body.
 */
export async function clickIssueInvoiceAndExpectSuccess(
  page: Page,
): Promise<{ id: number; invoiceNumberFormatted: string }> {
  await ensurePaymentMethodChosen(page);
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
 * Expected receipt PDF filename: COMPROBANTE-NO-FISCAL-<yyyymmdd>-<001-001-0000123>.pdf (suffix -TICKET for the
 * 80 mm format), where the date is the emission date rendered in the business timezone (America/Asuncion) and
 * the number is establishment-expedition point-invoice number.
 */
export function expectedInvoiceFilename(
  issuedAtIso: string,
  invoiceNumberFormatted: string,
  format: "A4" | "TICKET" = "A4",
): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Asuncion",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(issuedAtIso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `COMPROBANTE-NO-FISCAL-${get("year")}${get("month")}${get("day")}-${invoiceNumberFormatted}${format === "TICKET" ? "-TICKET" : ""}.pdf`;
}

/** Every FlateDecode stream of the PDF, inflated (streams that are not text, such as images, are skipped). */
function inflateAllStreams(pdf: Buffer): string[] {
  const out: string[] = [];
  const marker = Buffer.from("stream", "ascii");
  const end = Buffer.from("endstream", "ascii");
  let from = 0;
  for (;;) {
    const at = pdf.indexOf(marker, from);
    if (at < 0) break;
    // skip the «endstream» keyword itself
    if (at >= 3 && pdf.subarray(at - 3, at).toString("ascii") === "end") {
      from = at + marker.length;
      continue;
    }
    let start = at + marker.length;
    if (pdf[start] === 0x0d) start += 1;
    if (pdf[start] === 0x0a) start += 1;
    const stop = pdf.indexOf(end, start);
    if (stop < 0) break;
    try {
      out.push(zlib.inflateSync(pdf.subarray(start, stop)).toString("latin1"));
    } catch {
      // not a Flate text stream: ignore
    }
    from = stop + end.length;
  }
  return out;
}

function unescapePdfString(raw: string): string {
  return raw.replace(/\\([()\\])/g, "$1");
}

/**
 * `true` when `searchText` is drawn as one whole text item (`(text)Tj`, or one string of a `[(..)..]TJ` array) in
 * any content stream of the PDF. Whole-item equality, like the previous `(text)Tj` check, so «8.000» does not
 * match «18.000».
 */
export function pdfContainsText(pdf: Buffer, searchText: string): boolean {
  for (const stream of inflateAllStreams(pdf)) {
    for (const m of stream.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) {
      if (unescapePdfString(m[1]) === searchText) return true;
    }
    for (const arr of stream.matchAll(/\[((?:\\.|[^\]\\])*)\]\s*TJ/g)) {
      for (const str of arr[1].matchAll(/\(((?:\\.|[^\\)])*)\)/g)) {
        if (unescapePdfString(str[1]) === searchText) return true;
      }
    }
  }
  return false;
}
