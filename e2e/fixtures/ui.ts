import type { Page } from "@playwright/test";

/** Local calendar date as `YYYY-MM-DD`, `daysFromToday` days from today in the runner's timezone. */
export function localDatePlusDays(daysFromToday: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Picks an option from a `SearchableSelect` (combobox + listbox with the same accessible name).
 * Types `filterText` to narrow options, then clicks the matching row button.
 */
export async function pickSearchableOption(
  page: Page,
  accessibleName: string,
  filterText: string,
  optionNamePattern: RegExp,
): Promise<void> {
  /** `exact` avoids matching e.g. "Filter by professional" when looking for "Professional". */
  const cb = page.getByRole("combobox", { name: accessibleName, exact: true });
  await cb.click();
  await cb.fill("");
  await cb.fill(filterText);
  await page
    .getByRole("listbox", { name: accessibleName, exact: true })
    .getByRole("button", { name: optionNamePattern })
    .first()
    .click();
}
