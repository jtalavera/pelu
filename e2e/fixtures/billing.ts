import { expect, type Page } from "@playwright/test";

/** Opens the cash session with 0 initial amount when no session is active. */
export async function ensureCashSessionOpen(page: Page) {
  await page.goto("/app/billing");
  await page.getByRole("tab", { name: "Cash Register" }).click();
  const openBtn = page.getByRole("button", { name: "Open cash register" });
  if (await openBtn.isVisible()) {
    await page.getByLabel("Initial cash amount").fill("50000");
    await openBtn.click();
    await expect(page.getByText(/^Cash register is open$/)).toBeVisible({ timeout: 30_000 });
  }
}

/**
 * Switches the open invoice detail modal to its "SIFEN" tab, where every SIFEN detail and action
 * lives (status, message history, KuDE sharing, revalidate, cancel, identify client…). The
 * "Invoice" tab — shown first — holds the invoice data plus the KuDE download / assign-professional
 * buttons.
 */
export async function openInvoiceSifenTab(page: Page) {
  await page.getByRole("dialog").getByTestId("invoice-detail-tab-sifen").click();
  await expect(page.getByTestId("sifen-status-section")).toBeVisible();
}

/** Switches the open invoice detail modal back to its first ("Invoice") tab. */
export async function openInvoiceMainTab(page: Page) {
  await page.getByRole("dialog").getByTestId("invoice-detail-tab-invoice").click();
  await expect(page.getByTestId("invoice-detail-panel-invoice")).toBeVisible();
}
