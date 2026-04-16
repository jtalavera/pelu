import { expect, test } from "@playwright/test";
import { loginAsDemo } from "../fixtures/auth";

test.describe("HU-05 · Crear y gestionar profesionales", () => {
  test("página de profesionales con alta disponible", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/professionals");
    await expect(page.getByRole("heading", { name: "Professionals" })).toBeVisible();
    await expect(page.getByRole("button", { name: "+ New professional" })).toBeVisible();
  });

  test("HU-05 · 1 alta de profesional con nombre y pestaña de horarios", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/professionals");
    const name = `E2E Prof ${Date.now()}`;
    await page.getByRole("button", { name: "+ New professional" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Full name").fill(name);
    await dlg.getByRole("button", { name: "Save and set schedule" }).click();
    await dlg.locator("#prof-1-start").fill("09:00");
    await dlg.locator("#prof-1-end").fill("17:00");
    await dlg
      .getByRole("button", { name: "Save schedule" })
      .evaluate((el: HTMLElement) => (el as HTMLButtonElement).click());
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  });

  test("HU-05 · 4 listado muestra estado activo", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/professionals");
    await expect(page.getByText("Active", { exact: true }).first()).toBeVisible();
  });

  test("HU-05 · 3 desactivar y reactivar profesional", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/professionals");
    const name = `E2E Deact Prof ${Date.now()}`;
    await page.getByRole("button", { name: "+ New professional" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Full name").fill(name);
    await dlg.getByRole("button", { name: "Save and set schedule" }).click();
    await dlg.locator("#prof-1-start").fill("09:00");
    await dlg.locator("#prof-1-end").fill("17:00");
    await dlg
      .getByRole("button", { name: "Save schedule" })
      .evaluate((el: HTMLElement) => (el as HTMLButtonElement).click());

    const row = page.locator("tr").filter({ hasText: name });
    await row.getByRole("button", { name: "Deactivate" }).click();
    await page.getByRole("dialog", { name: "Deactivate professional" }).getByRole("button", { name: "Deactivate" }).click();
    await expect(row.getByText("Inactive", { exact: true })).toBeVisible();

    await row.getByRole("button", { name: "Activate" }).click();
    await page.getByRole("dialog", { name: "Activate professional" }).getByRole("button", { name: "Activate" }).click();
    await expect(row.getByText("Active", { exact: true })).toBeVisible();
  });
});
