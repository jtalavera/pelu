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
  const escaped = serviceFullName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await page.locator(`#billing-line-svc-${lineIdx}`).fill(serviceFullName.slice(0, 12));
  await page.getByRole("button", { name: new RegExp(escaped) }).click();
}

/** Waits for POST /api/invoices success and the success alert (title "Invoice issued"). */
export async function clickIssueInvoiceAndExpectSuccess(page: Page) {
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
}
