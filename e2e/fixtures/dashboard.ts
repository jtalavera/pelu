import { expect, type Locator, type Page } from "@playwright/test";

/** «Hoy» only has the fichas of the day now (occupancy, birthdays and inactive clients left it, HU-78). */
export type DashboardMoreSection = "records";

export async function openDashboardMore(page: Page, section: DashboardMoreSection): Promise<void> {
  // "Fichas de hoy" are always-visible cards (not a folded section): nothing to open.
  if (section === "records") {
    await expect(page.getByTestId("dashboard-today-records")).toBeVisible({ timeout: 20_000 });
  }
}

/**
 * The Inicio's «Fichas de servicio de hoy»: the OPEN fichas are always on view, while the paid and
 * voided ones wait in the folded «Cobradas y anuladas», 12 at a time with «Más (n)». Opens the fold
 * and pages through it until the ficha of `clientName` is on screen, and returns its card.
 */
export async function revealFichaCard(page: Page, clientName: string | RegExp): Promise<Locator> {
  const card = page.getByTestId("dashboard-service-record-card").filter({ hasText: clientName }).first();
  const toggle = page.getByTestId("dashboard-service-records-closed-toggle");
  const more = page.getByTestId("dashboard-service-records-more");
  await expect(page.getByTestId("dashboard-today-records")).toBeVisible({ timeout: 20_000 });
  for (let i = 0; i < 80 && !(await card.isVisible()); i++) {
    if ((await toggle.isVisible()) && (await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    else if (await more.isVisible()) await more.click();
    else await page.waitForTimeout(500);
  }
  await expect(card).toBeVisible();
  return card;
}

/**
 * The Inicio's «Turnos de hoy»: what is still to attend or charge is on view and the CHARGED turnos
 * (completed, with a comprobante) wait in the folded «Cobrados». Opens that fold if the row is not on
 * view yet. `narrow` picks the row out of all the rows (e.g. `(rows) => rows.filter({ hasText: name })`).
 */
export async function revealAppointmentRow(
  page: Page,
  narrow: (rows: Locator) => Locator,
): Promise<Locator> {
  const row = narrow(page.getByTestId("dashboard-appointment-row")).first();
  const toggle = page.getByTestId("dashboard-appointments-charged-toggle");
  for (let i = 0; i < 40 && !(await row.isVisible()); i++) {
    if ((await toggle.isVisible()) && (await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    else await page.waitForTimeout(500);
  }
  await expect(row).toBeVisible({ timeout: 20_000 });
  return row;
}
