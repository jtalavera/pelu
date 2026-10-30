import { expect, type Locator, type Page } from "@playwright/test";

/** Catalog redesign: Servicios, Productos and Profesionales are views of one screen. */
export type CatalogView = "services" | "products" | "professionals";

export async function goToCatalog(page: Page, view: CatalogView = "services"): Promise<void> {
  await page.goto(`/app/catalog?view=${view}`);
  await expect(page.getByTestId(`catalog-view-${view}`)).toHaveAttribute("aria-selected", "true", {
    timeout: 20_000,
  });
}

/** Opens a "⋯" menu item of Servicios/Productos: `price-list` or `categories`. */
export async function openCatalogMenuItem(page: Page, item: "price-list" | "categories"): Promise<void> {
  await page.getByTestId("catalog-more-trigger").click();
  await page.getByTestId(`catalog-more-item-${item}`).click();
}

/** "Administrar categorías": the categories dialog (create, edit, activate / deactivate). */
export async function openCategoriesDialog(page: Page): Promise<Locator> {
  await openCatalogMenuItem(page, "categories");
  const dialog = page.getByTestId("catalog-categories-dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Opens the "Más opciones" section of the item form (tax, SKU); no-op when already open. */
export async function openItemMoreOptions(page: Page): Promise<void> {
  const toggle = page.getByTestId("svc-more-options-toggle");
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

/** Opens the "Más opciones" section of the professional form (email, PIN, access, photo). */
export async function openProfessionalMoreOptions(page: Page): Promise<void> {
  const toggle = page.getByTestId("prof-more-options-toggle");
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

/** Opens the schedule day rows of the professional form ("Cambiar"); no-op when already open. */
export async function openProfessionalSchedule(page: Page): Promise<void> {
  const toggle = page.getByTestId("prof-schedule-toggle");
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

/** Row switch of a service / product (`svc-switch-<id>`) or professional (`prof-switch-<id>`). */
export function catalogSwitch(page: Page, kind: "svc" | "prof", id: number | string): Locator {
  return page.getByTestId(`${kind}-switch-${id}`);
}
