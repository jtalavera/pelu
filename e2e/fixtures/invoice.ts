import { expect, type Page } from "@playwright/test";

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
