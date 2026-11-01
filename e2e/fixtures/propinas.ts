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
 * Opens the withdraw dialog of one professional. Balances are sorted by amount and paged 5 at a
 * time, so the helper pages forward until the professional's row is on screen.
 */
export async function openWithdrawDialog(page: Page, professionalId: number): Promise<void> {
  const button = page.getByTestId(`propinas-withdraw-${professionalId}`);
  const next = page.getByTestId("propinas-balances-next");
  for (let i = 0; i < 40 && !(await button.isVisible()); i++) {
    if (!(await next.isVisible()) || (await next.isDisabled())) break;
    await next.click();
  }
  await button.click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

/** Balance shown for a professional in the balances card (pages forward like openWithdrawDialog). */
export async function propinasBalanceOf(page: Page, professionalId: number) {
  const balance = page.getByTestId(`propinas-balance-${professionalId}`);
  const next = page.getByTestId("propinas-balances-next");
  for (let i = 0; i < 40 && !(await balance.isVisible()); i++) {
    if (!(await next.isVisible()) || (await next.isDisabled())) break;
    await next.click();
  }
  return balance;
}
