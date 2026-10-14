import { expect, type Page } from "@playwright/test";

import { clickIssueInvoiceAndExpectSuccess, pickServiceLine } from "../invoice";
import { peluOk } from "./api";

export type InvoiceLineInput = { serviceId: number; name: string; quantity: number; unitPrice?: number };

/** Issues a plain comprobante through the API (occasional client, cash). */
export async function issueInvoiceApi(
  token: string,
  lines: InvoiceLineInput[],
): Promise<{ id: number; invoiceNumberFormatted: string }> {
  const total = lines.reduce((sum, l) => sum + l.quantity * (l.unitPrice ?? 50000), 0);
  return peluOk("/api/invoices", {
    token,
    body: {
      clientId: null,
      clientDisplayName: "Cliente Stock E2E",
      clientRucOverride: null,
      discountType: "NONE",
      discountValue: null,
      lines: lines.map((l) => ({
        serviceId: l.serviceId,
        description: l.name,
        quantity: l.quantity,
        unitPrice: l.unitPrice ?? 50000,
        discountType: null,
        discountValue: null,
      })),
      payments: [{ method: "CASH", amount: total, cardBrand: null, cardBrandOtherDescription: null }],
    },
  });
}

/** Opens "New Invoice" with an occasional client and fills the given lines (no submit). */
export async function fillNewInvoiceUi(page: Page, lines: InvoiceLineInput[]): Promise<void> {
  await page.goto("/app/billing");
  await page.getByRole("tab", { name: "Cash Register" }).click();
  await page.getByRole("button", { name: "New Invoice" }).click();
  await page.getByLabel("Search or select client").click();
  await page.getByRole("button", { name: "Occasional client" }).click();
  await page.getByLabel("Client name / business name").fill("Cliente Stock E2E");
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) await page.getByRole("button", { name: "Add item" }).click();
    await pickServiceLine(page, lines[i].name, i);
    await page.locator(`#line-qty-${i}`).fill(String(lines[i].quantity));
  }
  const total = lines.reduce((sum, l) => sum + l.quantity * (l.unitPrice ?? 50000), 0);
  await page.locator("#pay-amount-0").fill(String(total));
  await expect(page.locator("#pay-amount-0")).toHaveValue(total.toLocaleString("es-PY"));
}

export async function issueInvoiceUi(
  page: Page,
  lines: InvoiceLineInput[],
): Promise<{ id: number; invoiceNumberFormatted: string }> {
  await fillNewInvoiceUi(page, lines);
  return clickIssueInvoiceAndExpectSuccess(page);
}
