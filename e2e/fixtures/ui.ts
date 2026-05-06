import type { Locator, Page } from "@playwright/test";

/** Appointment create/edit modal (avoids grabbing the nested date-picker dialog, `aria-label="Calendar"`). */
export function bookingAppointmentDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: /^(New appointment|Edit appointment)$/ });
}

/** Professionals form modal (avoid picking confirm dialogs that also expose `role="dialog"`). */
export function professionalFormDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: /^(New professional|Edit professional)$/ });
}

/**
 * Seeds may land slightly outside the default week rendered at `/app/calendar`.
 * Advances "Next week" then walks "Previous week" until the client card appears.
 */
export async function ensureCalendarShowsClientCard(
  page: Page,
  clientNameMatcher: RegExp | string,
  opts?: { maxAheadWeeks?: number; maxBackWeeks?: number },
): Promise<void> {
  await ensureLocatorVisibleByWeekNavigation(
    page,
    () => page.getByRole("button", { name: clientNameMatcher }).first(),
    opts,
  );
}

export async function ensureCalendarShowsAppointmentByTestId(
  page: Page,
  testId: string,
  opts?: { maxAheadWeeks?: number; maxBackWeeks?: number },
): Promise<void> {
  await ensureLocatorVisibleByWeekNavigation(page, () => page.getByTestId(testId).first(), opts);
}

async function ensureLocatorVisibleByWeekNavigation(
  page: Page,
  locate: () => Locator,
  opts?: { maxAheadWeeks?: number; maxBackWeeks?: number },
): Promise<void> {
  const maxAhead = opts?.maxAheadWeeks ?? 8;
  const maxBack = opts?.maxBackWeeks ?? 20;
  const target = () => locate();
  if (await target().isVisible().catch(() => false)) return;

  const nextWeek = page.getByRole("button", { name: "Next week", exact: true });
  const prevWeek = page.getByRole("button", { name: "Previous week", exact: true });

  const clickNavAndAwaitGrid = async (btn: Locator): Promise<void> => {
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.request().method() === "GET" && new URL(r.url()).pathname === "/api/appointments",
        { timeout: 25_000 },
      ),
      btn.click(),
    ]);
  };

  for (let i = 0; i < maxAhead; i++) {
    await clickNavAndAwaitGrid(nextWeek);
    if (await target().isVisible().catch(() => false)) return;
  }
  for (let i = 0; i < maxBack; i++) {
    await clickNavAndAwaitGrid(prevWeek);
    if (await target().isVisible().catch(() => false)) return;
  }

  await target().waitFor({ state: "visible", timeout: 8_000 });
}

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

/**
 * Calendar modal: `LocalizedDateInput` parses full ISO only when complete — typing can leave the parent
 * `value` stale until done. Selecting the day button (`aria-label` = ISO date) avoids flakiness and popover focus issues.
 */
export async function fillAppointmentDateIso(dialog: Locator, isoYmd: string): Promise<void> {
  const input = dialog.getByTestId("appointment-date-input");
  await input.click();
  const monthNext = dialog.getByRole("button", { name: "Next month" });
  const dayBtn = dialog.getByRole("button", { name: isoYmd, exact: true });
  for (let i = 0; i < 14; i++) {
    const visible = await dayBtn.first().isVisible().catch(() => false);
    if (visible) break;
    await monthNext.click();
  }
  await dayBtn.first().click({ timeout: 15_000 });
}

/** Same interaction pattern as calendar `appointment-time-input` (`TimeCombobox`). */
export async function fillTimeComboboxField(locator: Locator, hhMm: string): Promise<void> {
  await locator.focus();
  await locator.evaluate((el) => (el as HTMLInputElement).select());
  const page = locator.page();
  await page.keyboard.press("Backspace");
  await page.keyboard.type(hhMm, { delay: 25 });
  await locator.press("Enter");
}
export async function fillAppointmentTime(dialog: Locator, hhMm: string): Promise<void> {
  const input = dialog.getByTestId("appointment-time-input");
  await input.focus();
  await input.evaluate((el) => (el as HTMLInputElement).select());
  await input.page().keyboard.press("Backspace");
  await input.page().keyboard.type(hhMm, { delay: 25 });
  await input.press("Enter");
}

/**
 * Controlled React inputs: `fill`/`pressSequentially` alone can diverge DOM from React state (masking/formatters).
 * Select-all + `keyboard.type` dispatches trusted input events reliably.
 */
export async function setControlledInputValue(locator: Locator, value: string): Promise<void> {
  await locator.focus();
  await locator.evaluate((el) => (el as HTMLInputElement).select());
  const page = locator.page();
  await page.keyboard.press("Backspace");
  await page.keyboard.type(value, { delay: 25 });
}
