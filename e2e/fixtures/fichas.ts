import { expect, type Locator, type Page } from "@playwright/test";
import { openFichaByText } from "./ui";

/** Opens the "New service record" dialog from the list. */
export async function openNewFichaDialog(page: Page): Promise<Locator> {
  await page.goto("/app/service-records");
  await page.getByTestId("service-records-new").click();
  const dlg = page.getByRole("dialog");
  await expect(dlg).toBeVisible();
  return dlg;
}

/** Picks a client in the dialog's client search (suggestions render in a portal). */
export async function pickFichaClient(page: Page, dlg: Locator, fullName: string): Promise<void> {
  await dlg.getByLabel("Search or select client").fill(fullName.slice(0, 8));
  await page.getByRole("button", { name: fullName, exact: false }).first().click();
}

/** Adds an empty service line (opened by default) to the dialog. */
export async function addFichaLine(dlg: Locator): Promise<void> {
  await dlg.getByTestId("service-record-add-line").click();
}

/** Lines can fold themselves (e.g. when another one is added): reopen the n-th line if needed. */
async function ensureLineOpen(page: Page, idx: number): Promise<void> {
  const field = page.locator(`#service-record-line-svc-${idx}`);
  if (await field.isVisible().catch(() => false)) return;
  await page.getByRole("dialog").getByTestId("service-record-line-toggle").nth(idx).click();
  await expect(field).toBeVisible();
}

export async function pickLineService(page: Page, idx: number, serviceFullName: string): Promise<void> {
  await ensureLineOpen(page, idx);
  await page.locator(`#service-record-line-svc-${idx}`).fill(serviceFullName.slice(0, 12));
  await page
    .locator(`#service-record-line-svc-${idx}-listbox`)
    .getByRole("button", { name: serviceFullName, exact: false })
    .first()
    .click();
  // A debounced search may still be in flight and re-open the suggestion list over the form;
  // let it land, then click the dialog title to close it (Escape would close the whole dialog).
  await page.waitForTimeout(700);
  await page.getByRole("dialog").getByRole("heading", { name: /^New service record|Service record/ }).first().click();
}

export async function pickLineProfessional(page: Page, idx: number, fullName: string): Promise<void> {
  await ensureLineOpen(page, idx);
  const input = page.locator(`#service-record-line-prof-${idx}`);
  await input.click();
  await input.fill(fullName);
  await page
    .locator(`#service-record-line-prof-${idx}-listbox`)
    .getByRole("button", { name: fullName, exact: false })
    .first()
    .click();
}

/** Opens a ficha (any status) from the "All" list by free text; returns its dialog. */
export async function openFichaDialog(page: Page, text: string): Promise<Locator> {
  await openFichaByText(page, text);
  const dlg = page.getByRole("dialog");
  await expect(dlg).toBeVisible();
  return dlg;
}

/** Makes sure the n-th service line of the open dialog is expanded (lines fold when there are several). */
export async function expandFichaLine(dlg: Locator, idx: number): Promise<void> {
  const line = dlg.getByTestId("service-record-line").nth(idx);
  const toggle = line.getByTestId("service-record-line-toggle");
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
}
