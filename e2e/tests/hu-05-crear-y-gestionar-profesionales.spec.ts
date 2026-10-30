import { expect, test } from "@playwright/test";
import { apiPostJson, loginAsDemoApi } from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { professionalFormDialog, fillTimeComboboxField } from "../fixtures/ui";
import { openProfessionalMoreOptions, openProfessionalSchedule, toggleRowSwitch } from "../fixtures/catalog";

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
    const row = page.locator('[data-testid^="prof-row-"]').filter({ hasText: n2 }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.click();
    const dlg = professionalFormDialog(page);
    await openProfessionalMoreOptions(page);
    await dlg.getByLabel("Email").fill(email);
    await dlg.getByTestId("prof-save").click();
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
    const dlg = professionalFormDialog(page);
    await dlg.getByLabel("Full name").fill(name);
    await openProfessionalSchedule(page);
    await dlg.getByTestId("prof-day-mon-active").check();
    await fillTimeComboboxField(dlg.locator("#prof-1-start"), "09:00");
    await fillTimeComboboxField(dlg.locator("#prof-1-end"), "17:00");
    await dlg.getByTestId("prof-save").click();
    // Issue #163 AC2: a new-professional save shows a success message in the page header,
    // same style as saving a Ficha de servicio.
    await expect(page.getByText("Professional saved successfully.", { exact: true })).toBeVisible();
    // The list is server-side paginated (HU-32); search for the new professional so it
    // is not missed on a later page as professionals accumulate.
    await page.locator("#professionals-inline-search").fill(name);
    // Names are stored in UPPERCASE (issue #155 AC3), regardless of the case typed here.
    await expect(page.getByText(name.toUpperCase(), { exact: true }).first()).toBeVisible();
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
    const dlg = professionalFormDialog(page);
    await dlg.getByLabel("Full name").fill(name);
    await openProfessionalSchedule(page);
    await dlg.getByTestId("prof-day-mon-active").check();
    await fillTimeComboboxField(dlg.locator("#prof-1-start"), "09:00");
    await fillTimeComboboxField(dlg.locator("#prof-1-end"), "17:00");
    await dlg.getByTestId("prof-save").click();

    const row = page.locator('[data-testid^="prof-row-"]').filter({ hasText: name }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });

    await toggleRowSwitch(row);
    await page.getByRole("dialog", { name: "Deactivate professional" }).getByRole("button", { name: "Deactivate" }).click();
    await expect(row.getByText("Inactive", { exact: true })).toBeVisible();
    // Issue #163 AC3: deactivating from the table shows a success message in the page header.
    await expect(
      page.getByText("Professional deactivated successfully.", { exact: true }),
    ).toBeVisible();

    await toggleRowSwitch(row);
    await page.getByRole("dialog", { name: "Activate professional" }).getByRole("button", { name: "Activate" }).click();
    await expect(row.getByText("Active", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Professional activated successfully.", { exact: true }),
    ).toBeVisible();
  });

  test("Issue #165 · AC1 el mensaje de éxito usa el tamaño de letra del buscador y no toca la tabla", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await page.goto("/app/professionals");
    const name = `E2E FontSize Prof ${Date.now()}`;
    await page.getByRole("button", { name: "+ New professional" }).click();
    const dlg = professionalFormDialog(page);
    await dlg.getByLabel("Full name").fill(name);
    await openProfessionalSchedule(page);
    await dlg.getByTestId("prof-day-mon-active").check();
    await fillTimeComboboxField(dlg.locator("#prof-1-start"), "09:00");
    await fillTimeComboboxField(dlg.locator("#prof-1-end"), "17:00");
    await dlg.getByTestId("prof-save").click();

    const alert = page.getByText("Professional saved successfully.", { exact: true });
    await expect(alert).toBeVisible();
    const search = page.locator("#professionals-inline-search");
    await expect(search).toBeVisible();

    const [alertFontSize, searchFontSize] = await Promise.all([
      alert.evaluate((el) => getComputedStyle(el).fontSize),
      search.evaluate((el) => getComputedStyle(el).fontSize),
    ]);
    expect(alertFontSize).toBe(searchFontSize);

    // The message box must leave a gap before the table header — not touch it directly.
    const gap = await page.evaluate(() => {
      const alertEl = document.querySelector('[role="alert"]');
      const table = document.querySelector("table");
      if (!alertEl || !table) return null;
      return table.getBoundingClientRect().top - alertEl.getBoundingClientRect().bottom;
    });
    expect(gap).not.toBeNull();
    expect(gap as number).toBeGreaterThan(8);
  });
});
