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
