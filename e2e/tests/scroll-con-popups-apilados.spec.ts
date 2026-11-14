import { expect, test } from "@playwright/test";
import { loginAsDemo } from "../fixtures/auth";

/**
 * La página vuelve a poder scrollearse después de abrir y cerrar popups desde Inicio, incluso si
 * se abren varios seguidos (antes cada popup restauraba el «overflow» que encontró y podía dejar
 * el body bloqueado para siempre).
 */
test.describe("Inicio · scroll tras abrir y cerrar popups", () => {
  test("el body no queda bloqueado después de abrir y cerrar «Nueva ficha» y «Nuevo turno»", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/hoy");
    const overflow = () => page.evaluate(() => document.body.style.overflow);

    const newRecord = page.getByTestId("dashboard-new-service-record");
    await expect(newRecord).toBeVisible({ timeout: 20_000 });
    await newRecord.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(await overflow()).toBe("hidden");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await overflow()).toBe("");

    await page.locator('[data-tour="dashboard-new-appointment"]').click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(await overflow()).toBe("hidden");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await overflow()).toBe("");
  });
});
