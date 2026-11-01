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
  // `isVisible()` is a point-in-time check with no auto-wait, so give React a beat to
  // paint after each navigation/fetch — otherwise the sweep races past the matching week.
  const isNowVisible = (timeout: number) =>
    target()
      .waitFor({ state: "visible", timeout })
      .then(() => true)
      .catch(() => false);
  if (await isNowVisible(500)) return;

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
    if (await isNowVisible(1_500)) return;
  }
  for (let i = 0; i < maxBack; i++) {
    await clickNavAndAwaitGrid(prevWeek);
    if (await isNowVisible(1_500)) return;
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
  // The date popover renders in a body-level portal (FloatingDropdown), so it is
  // NOT a descendant of the appointment dialog — scope its controls to the page.
  const page = dialog.page();
  const monthNext = page.getByRole("button", { name: "Next month" });
  const dayBtn = page.getByRole("button", { name: isoYmd, exact: true });
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

// ── Agenda redesign: professional chips and status actions in the appointment detail ───────────

/** Picks a professional chip of the Agenda ("All professionals" for no filter). */
export async function filterAgendaByProfessional(page: Page, name: string | RegExp): Promise<void> {
  const group = page.locator("[data-tour='calendar-prof-filter']");
  if (name === "All") {
    await group.getByTestId("calendar-prof-chip-all").click();
    return;
  }
  const chip = group.getByRole("button", { name }).first();
  await chip.click();
}

async function openAppointmentActions(page: Page): Promise<void> {
  const more = page.getByTestId("calendar-more-actions");
  if ((await more.getAttribute("aria-expanded")) !== "true") await more.click();
}

/** Detail dialog → "⋯" → "Mark as completed". */
export async function completeAppointmentFromDetail(page: Page): Promise<void> {
  await openAppointmentActions(page);
  await page.getByTestId("calendar-action-complete").click();
}

/** Detail dialog → "⋯" → "Cancel appointment" → reason → confirm. */
export async function cancelAppointmentFromDetail(page: Page, reason?: string): Promise<void> {
  await openAppointmentActions(page);
  await page.getByTestId("calendar-action-cancel").click();
  if (reason) await page.locator("#cancel-reason").fill(reason);
  await page.getByTestId("calendar-cancel-confirm").click();
}

/** Detail dialog → "⋯" → "Edit appointment". */
export async function openEditFromDetail(page: Page): Promise<void> {
  await openAppointmentActions(page);
  await page.getByTestId("calendar-action-edit").click();
}

/**
 * Opens a service record (ficha) from the redesigned list: shows every status, filters by text and
 * clicks the first matching row (which opens the detail dialog).
 */
export async function openFichaByText(page: import("@playwright/test").Page, text: string) {
  await page.goto("/app/service-records");
  await page.getByTestId("service-records-chip-all").click();
  await page.locator("#service-record-history-text-filter").fill(text);
  await page
    .locator('[data-testid^="service-record-row-"]')
    .filter({ hasText: text })
    .first()
    // Top-left of the row (name area): on narrow screens the centre can fall on "Charge".
    .click({ position: { x: 70, y: 12 } });
}

/**
 * Opens the weekly calendar and moves forward (up to 3 weeks) until the appointment with the given
 * id is on the grid. Seeded slots can land in next week (e.g. on Sunday evening) because the helper
 * only guarantees "a future slot", not "inside the week shown on open".
 */
export async function advanceWeekUntilAppointment(
  page: import("@playwright/test").Page,
  appointmentId: number,
) {
  const appt = page.getByTestId(`calendar-appt-${appointmentId}`);
  for (let i = 0; i < 3; i++) {
    if (await appt.isVisible().catch(() => false)) return;
    await page.getByRole("button", { name: "Next week" }).click();
    await page.waitForTimeout(500);
  }
}

export async function openWeekWithAppointment(
  page: import("@playwright/test").Page,
  appointmentId: number,
) {
  await page.goto("/app/calendar?view=week");
  const appt = page.getByTestId(`calendar-appt-${appointmentId}`);
  for (let i = 0; i < 3; i++) {
    if (await appt.isVisible().catch(() => false)) return;
    await page.getByRole("button", { name: "Next week" }).click();
    await page.waitForTimeout(500);
  }
}

/** Configuración → SIFEN: the sections are folds (`certificate` | `csc` | `numberVoiding`). Opens one. */
export async function openSifenSection(
  page: import("@playwright/test").Page,
  section: "certificate" | "csc" | "numberVoiding",
) {
  await page.goto("/app/settings/sifen");
  const fold = page.getByTestId(`sifen-fold-${section}`);
  await fold.waitFor({ state: "visible" });
  if ((await fold.getAttribute("aria-expanded")) !== "true") await fold.click();
}

/** Opens one SIFEN fold on the Configuración → SIFEN page that is already loaded. */
export async function unfoldSifen(
  page: import("@playwright/test").Page,
  section: "certificate" | "csc" | "numberVoiding",
) {
  const fold = page.getByTestId(`sifen-fold-${section}`);
  await fold.waitFor({ state: "visible" });
  if ((await fold.getAttribute("aria-expanded")) !== "true") await fold.click();
}

/** Configuración → SIFEN → Voided numbering: opens the manual-voiding dialog; returns its form. */
export async function openManualVoidingForm(page: import("@playwright/test").Page) {
  await page.getByTestId("sifen-number-voiding-manual-open").click();
  const form = page.getByTestId("sifen-number-voiding-manual-form");
  await form.waitFor({ state: "visible" });
  return form;
}

/** Configuración → Negocio: opens a fold (`general` | `contact` | `sifen` | `logo`) if closed. */
export async function openBusinessSection(
  page: import("@playwright/test").Page,
  id: "general" | "contact" | "sifen" | "logo",
) {
  const toggle = page.getByTestId(`business-section-${id}-toggle`);
  await toggle.waitFor({ state: "visible" });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
}

/** Configuración → Timbrado: opens the "Add stamp" dialog and waits for its form. */
export async function openAddStampDialog(page: import("@playwright/test").Page) {
  await page.goto("/app/settings/fiscal-stamp");
  await page.getByTestId("fiscal-stamp-add").click();
  await page.getByLabel("Stamp number", { exact: true }).waitFor({ state: "visible" });
}

/** Clicks an item (`/^Edit/`, `/^Activate/`, `/^Deactivate/`, `/^Delete/`) of a stamp row's ⋯ menu. */
export async function stampRowAction(
  page: import("@playwright/test").Page,
  row: import("@playwright/test").Locator,
  action: RegExp,
) {
  await row.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await row.getByRole("button", { name: /actions|acciones/i }).click();
  // dispatchEvent: the menu of the last row can open below the page end, out of the viewport.
  await page.getByRole("menuitem", { name: action }).dispatchEvent("click");
}

/** Resumen: opens the folded "Ver más detalle" block (top services, payment methods, weekdays). */
export async function openSummaryMore(page: import("@playwright/test").Page) {
  const toggle = page.getByTestId("summary-more-toggle");
  await toggle.waitFor({ state: "visible" });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await page.getByTestId("summary-more").waitFor({ state: "visible" });
}

/** Configuración: opens the "More" (⋯) menu and picks one of its items (Taxes | Audit | Shared devices). */
export async function openSettingsMoreItem(
  page: import("@playwright/test").Page,
  name: RegExp | string,
) {
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name }).click();
}
