import { expect, test } from "@playwright/test";
import { apiPostJson, loginAsDemoApi } from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

test.describe("HU-05 · Crear y gestionar profesionales", () => {
  test("HU-05 · unicidad email: segundo profesional con mismo mail muestra error", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const email = `e2e-dup-${Date.now()}@test.local`;
    const n1 = `E2E Eml A ${Date.now()}`;
    const n2 = `E2E Eml B ${Date.now()}`;
    await apiPostJson(request, token, "/api/professionals", {
      fullName: n1,
      phone: null,
      email,
      photoDataUrl: null,
    });
    await apiPostJson(request, token, "/api/professionals", {
      fullName: n2,
      phone: null,
      email: null,
      photoDataUrl: null,
    });

    await loginAsDemo(page);
    await page.goto("/app/professionals");
    const row = page.locator("tr").filter({ hasText: n2 });
    await row.getByRole("button", { name: "More…", exact: true }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Email").fill(email);
    await dlg.getByRole("button", { name: "Save and set schedule" }).click();
    await expect(
      dlg.getByText("Another professional in your business already uses this email address.", {
        exact: true,
      }),
    ).toBeVisible();
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
