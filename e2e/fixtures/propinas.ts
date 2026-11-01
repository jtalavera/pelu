import { expect, type Page } from "@playwright/test";

/** Opens Propinas and restricts it to one (active) professional through the folded Filters. */
export async function filterPropinasByProfessional(page: Page, fullName: string): Promise<void> {
  const toggle = page.getByTestId("propinas-filters-toggle");
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  const select = page.locator("#propinas-filter-professional");
  const value = await select.evaluate((el, name) => {
    const opt = Array.from((el as HTMLSelectElement).options).find(
      (o) => o.text.trim().toLowerCase() === String(name).trim().toLowerCase(),
    );
    return opt ? opt.value : null;
  }, fullName);
  expect(value, `professional "${fullName}" in the Propinas filter`).not.toBeNull();
  await select.selectOption(value!);
}

/** Movement rows (tips and withdrawals) of the Movimientos table. */
export function propinasMovements(page: Page) {
  return page.getByTestId("propinas-movement");
}

/** Clicks "Export PDF" in the page header ⋯ menu. */
export async function clickExportPdf(page: Page): Promise<void> {
  await page.getByRole("button", { name: "More actions" }).first().click();
  await page.getByRole("menuitem", { name: "Export PDF" }).click();
}

/**
 * Scrolls the (sorted, 5-per-page) balances card until the professional's row is on screen.
 * Balances load after the list, which reorders it, so settle first and rescan from page 1.
 */
async function revealBalanceRow(page: Page, professionalId: number): Promise<void> {
  const row = page.getByTestId(`propinas-card-${professionalId}`);
  const next = page.getByTestId("propinas-balances-next");
  const prev = page.getByTestId("propinas-balances-prev");
  await page.waitForLoadState("networkidle");
  for (let pass = 0; pass < 3; pass++) {
    if (await row.isVisible()) return;
    while ((await prev.isVisible()) && (await prev.isEnabled())) await prev.click();
    for (let i = 0; i < 60; i++) {
      if (await row.isVisible()) return;
      if (!(await next.isVisible()) || (await next.isDisabled())) break;
      await next.click();
    }
    await page.waitForTimeout(500);
  }
  await expect(row).toBeVisible();
}

/** Opens the withdraw dialog of one professional. */
export async function openWithdrawDialog(page: Page, professionalId: number): Promise<void> {
  await revealBalanceRow(page, professionalId);
  await page.getByTestId(`propinas-withdraw-${professionalId}`).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

/** Balance shown for a professional in the balances card. */
export async function propinasBalanceOf(page: Page, professionalId: number) {
  await revealBalanceRow(page, professionalId);
  return page.getByTestId(`propinas-balance-${professionalId}`);
}

/** Asserts a professional's accumulated balance; retries because refreshes reorder the card. */
export async function expectBalance(page: Page, professionalId: number, text: string): Promise<void> {
  await expect(async () => {
    await revealBalanceRow(page, professionalId);
    await expect(page.getByTestId(`propinas-balance-${professionalId}`)).toHaveText(text, {
      timeout: 2_000,
    });
  }).toPass({ timeout: 20_000 });
}
