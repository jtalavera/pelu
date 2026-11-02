import { expect, test } from "@playwright/test";
import { loginAsDemo } from "../fixtures/auth";

/**
 * Barra inferior en celular: Inicio y Agenda siempre a un toque, «Más» abre el menú completo.
 * Solo aparece en pantallas chicas (< 640 px); en tablet y computadora queda el menú de siempre.
 */
test.describe("Barra inferior de navegación", () => {
  test("en celular: Inicio y Agenda a un toque, Más abre el menú", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAsDemo(page);

    const bar = page.getByTestId("bottom-nav");
    await expect(bar).toBeVisible();
    await expect(bar.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");

    await bar.getByRole("link", { name: "Calendar" }).click();
    await expect(page).toHaveURL(/\/app\/calendar/);
    await expect(bar.getByRole("link", { name: "Calendar" })).toHaveAttribute("aria-current", "page");

    const more = bar.getByTestId("bottom-nav-more");
    await expect(more).toBeVisible();
    const box = await more.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await more.click();
    await expect(page.getByTestId("app-sidebar")).toBeVisible();
    await expect(bar).toHaveCount(0);

    await page.getByTestId("nav-drawer-toggle").click();
    await expect(bar).toBeVisible();
  });

  test("en computadora no hay barra inferior", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await loginAsDemo(page);
    await expect(page.getByTestId("app-sidebar")).toBeVisible();
    await expect(page.getByTestId("bottom-nav")).toHaveCount(0);
  });
});
