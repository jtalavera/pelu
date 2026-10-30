import { expect, test } from "@playwright/test";
import { loginAsDemo } from "../fixtures/auth";
import { closeCategoriesDialog, openCategoriesDialog, toggleRowSwitch } from "../fixtures/catalog";

test.describe("HU-04 · Crear y gestionar servicios", () => {


  test("HU-04 · 1 CRUD categoría: crear y listar", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/services");
    await openCategoriesDialog(page);
    const name = `E2E Cat ${Date.now()}`;
    await page.getByRole("button", { name: "+ New category" }).click();
    await page.getByRole("dialog", { name: "New category" }).getByLabel("Name").fill(name);
    await page.getByRole("dialog", { name: "New category" }).getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  });

  test("HU-04 · 2 alta de servicio con categoría", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/services");
    await openCategoriesDialog(page);
    const cat = `SvcCat ${Date.now()}`;
    await page.getByRole("button", { name: "+ New category" }).click();
    await page.getByRole("dialog", { name: "New category" }).getByLabel("Name").fill(cat);
    await page.getByRole("dialog", { name: "New category" }).getByRole("button", { name: "Save" }).click();
    await closeCategoriesDialog(page);
    const svcName = `E2E Service ${Date.now()}`;
    await page.getByRole("button", { name: "+ New service" }).click();
    const svcDialog = page.getByRole("dialog", { name: "New service" });
    await svcDialog.getByLabel("Name").fill(svcName);
    await svcDialog.getByLabel("Category").selectOption({ label: cat });
    await svcDialog.getByLabel("Price").fill("50000");
    await expect(svcDialog.getByLabel("Price")).toHaveValue("50.000");
    await svcDialog.getByLabel("Duration (minutes)").fill("45");
    await svcDialog.getByRole("button", { name: "Save" }).click();
    await expect(svcDialog).not.toBeVisible();
    // Issue #163 AC1: saving a new service shows a success message in the table header,
    // same style as saving a Ficha de servicio.
    await expect(page.getByText("Service saved successfully.", { exact: true })).toBeVisible();
    // Search by name so the new service is on page 1 regardless of total count (server-side pagination)
    await page.getByPlaceholder(/search by name/i).fill(svcName);
    await page.waitForTimeout(600);
    await expect(page.getByText(svcName, { exact: true }).first()).toBeVisible();
    const svcRow = page.locator(`[data-testid^="svc-row-"]`).filter({ hasText: svcName });
    await expect(svcRow).toContainText("Gs. 50.000");
    // Issue #163 AC7 (catalog redesign): the status is the row switch, on for an active service.
    await expect(svcRow.locator('[data-testid^="svc-switch-"]')).toBeChecked();
  });

  test("Issue #163/#165 · AC8/AC9 desactivar y reactivar servicio: sin tachado ni fondo apagado, badge de estado, mensaje de éxito", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await page.goto("/app/services");
    await openCategoriesDialog(page);
    const cat = `DeactCat ${Date.now()}`;
    await page.getByRole("button", { name: "+ New category" }).click();
    await page.getByRole("dialog", { name: "New category" }).getByLabel("Name").fill(cat);
    await page.getByRole("dialog", { name: "New category" }).getByRole("button", { name: "Save" }).click();
    await closeCategoriesDialog(page);
    const svcName = `E2E Deact Svc ${Date.now()}`;
    await page.getByRole("button", { name: "+ New service" }).click();
    const svcDialog = page.getByRole("dialog", { name: "New service" });
    await svcDialog.getByLabel("Name").fill(svcName);
    await svcDialog.getByLabel("Category").selectOption({ label: cat });
    await svcDialog.getByLabel("Price").fill("15000");
    await svcDialog.getByLabel("Duration (minutes)").fill("20");
    await svcDialog.getByRole("button", { name: "Save" }).click();
    await expect(svcDialog).not.toBeVisible();

    await page.getByPlaceholder(/search by name/i).fill(svcName);
    await page.waitForTimeout(600);
    const svcRow = page.locator(`[data-testid^="svc-row-"]`).filter({ hasText: svcName });
    await expect(svcRow).toBeVisible();
    const svcSwitch = svcRow.locator('[data-testid^="svc-switch-"]');
    await expect(svcSwitch).toBeChecked();

    // Catalog redesign: the row switch turns the service off (after confirming) and back on.
    await toggleRowSwitch(svcRow);
    await page.getByRole("dialog", { name: "Deactivate service" }).getByRole("button", { name: "Deactivate" }).click();
    await expect(svcSwitch).not.toBeChecked();
    await expect(svcRow.getByText("Inactive", { exact: true })).toBeVisible();
    // AC8: the service name is never struck through.
    const nameDecoration = await svcRow
      .getByText(svcName, { exact: true })
      .evaluate((el) => getComputedStyle(el).textDecorationLine);
    expect(nameDecoration).toBe("none");
    // AC9: deactivating from the list shows a success message.
    await expect(page.getByText("Service deactivated successfully.", { exact: true })).toBeVisible();

    await toggleRowSwitch(svcRow);
    await expect(svcSwitch).toBeChecked();
    await expect(page.getByText("Service activated successfully.", { exact: true })).toBeVisible();
  });

  test("HU-04 · 3+6 edición de servicio vía pop-up al hacer click en la fila", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/services");
    await openCategoriesDialog(page);
    const cat = `EditCat ${Date.now()}`;
    await page.getByRole("button", { name: "+ New category" }).click();
    await page.getByRole("dialog", { name: "New category" }).getByLabel("Name").fill(cat);
    await page.getByRole("dialog", { name: "New category" }).getByRole("button", { name: "Save" }).click();
    await closeCategoriesDialog(page);
    const original = `ToEdit ${Date.now()}`;
    await page.getByRole("button", { name: "+ New service" }).click();
    const newDlg = page.getByRole("dialog", { name: "New service" });
    await newDlg.getByLabel("Name").fill(original);
    await newDlg.getByLabel("Category").selectOption({ label: cat });
    await newDlg.getByLabel("Price").fill("40000");
    await expect(newDlg.getByLabel("Price")).toHaveValue("40.000");
    await newDlg.getByLabel("Duration (minutes)").fill("30");
    await newDlg.getByRole("button", { name: "Save" }).click();
    await page.getByPlaceholder("Search by name or category…").fill(original);
    // HU-04 · 6: clicking the service row opens the edit modal (not just the label cell).
    await page.locator(`[data-testid^="svc-row-"]`).filter({ hasText: original }).first().click();
    const editDlg = page.getByRole("dialog", { name: "Edit service" });
    await expect(editDlg).toBeVisible();
    // Price pre-populated in edit dialog must use dot thousands separator, no decimals
    await expect(editDlg.getByLabel("Price")).toHaveValue("40.000");
    const renamed = `${original} renamed`;
    await editDlg.getByLabel("Name").fill(renamed);
    await editDlg.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(renamed, { exact: true }).first()).toBeVisible();
  });

  test("HU-04 · 7 edición de categoría vía pop-up al hacer click en la fila", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/services");
    await openCategoriesDialog(page);
    const original = `CatRow ${Date.now()}`;
    await page.getByRole("button", { name: "+ New category" }).click();
    await page
      .getByRole("dialog", { name: "New category" })
      .getByLabel("Name")
      .fill(original);
    await page
      .getByRole("dialog", { name: "New category" })
      .getByRole("button", { name: "Save" })
      .click();
    await page.locator(`[data-testid^="cat-row-"]`).filter({ hasText: original }).first().click();
    const editDlg = page.getByRole("dialog", { name: "Edit category" });
    await expect(editDlg).toBeVisible();
    const renamed = `${original} v2`;
    await editDlg.getByLabel("Name").fill(renamed);
    await editDlg.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(renamed, { exact: true }).first()).toBeVisible();
  });

  test("HU-04 · 5 búsqueda y filtro por categoría", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/services");
    await page.getByPlaceholder("Search by name or category…").fill("zzzznonexistent");
    await expect(page.getByText("No rows match your filter.")).toBeVisible();
    await page.getByPlaceholder("Search by name or category…").clear();
  });

  test("Catálogo · filtros de categoría como chips y sin filtros de estado", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/services");

    const filtersContainer = page.locator('[data-tour="services-filters"]');
    await expect(filtersContainer).toBeVisible();
    await expect(filtersContainer.getByRole("button", { name: "All categories", exact: true })).toBeVisible();
    // The status filters (All statuses / Active only / Inactive only) were replaced by the row switch.
    await expect(page.getByRole("button", { name: "All statuses", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Inactive only", exact: true })).toHaveCount(0);
  });

  test("Issue #165 · AC1 el mensaje de éxito usa el tamaño de letra del buscador y no toca la tabla", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await page.goto("/app/services");
    const svcName = `E2E FontSize Svc ${Date.now()}`;
    await page.getByRole("button", { name: "+ New service" }).click();
    const svcDialog = page.getByRole("dialog", { name: "New service" });
    await svcDialog.getByLabel("Name").fill(svcName);
    await svcDialog.getByLabel("Price").fill("5000");
    await svcDialog.getByLabel("Duration (minutes)").fill("15");
    await svcDialog.getByRole("button", { name: "Save" }).click();
    await expect(svcDialog).not.toBeVisible();

    const alert = page.getByText("Service saved successfully.", { exact: true });
    await expect(alert).toBeVisible();
    const search = page.getByPlaceholder(/search by name/i);
    await expect(search).toBeVisible();

    const [alertFontSize, searchFontSize] = await Promise.all([
      alert.evaluate((el) => getComputedStyle(el).fontSize),
      search.evaluate((el) => getComputedStyle(el).fontSize),
    ]);
    expect(alertFontSize).toBe(searchFontSize);

    // The message box must leave a gap before the table header — not touch it directly.
    const gap = await page.evaluate(() => {
      const alertEl = document.querySelector('[role="alert"]');
      const table = document.querySelector('[data-testid="catalog-items-list"]');
      if (!alertEl || !table) return null;
      return table.getBoundingClientRect().top - alertEl.getBoundingClientRect().bottom;
    });
    expect(gap).not.toBeNull();
    expect(gap as number).toBeGreaterThan(8);
  });

  test("Issue #165 · AC3 desactivar un servicio no reemplaza la página con el spinner de carga completa", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await page.goto("/app/services");
    const svcName = `E2E NoFlash Svc ${Date.now()}`;
    await page.getByRole("button", { name: "+ New service" }).click();
    const svcDialog = page.getByRole("dialog", { name: "New service" });
    await svcDialog.getByLabel("Name").fill(svcName);
    await svcDialog.getByLabel("Price").fill("5000");
    await svcDialog.getByLabel("Duration (minutes)").fill("15");
    await svcDialog.getByRole("button", { name: "Save" }).click();
    await expect(svcDialog).not.toBeVisible();

    await page.getByPlaceholder(/search by name/i).fill(svcName);
    await page.waitForTimeout(600);
    const svcRow = page.locator(`[data-testid^="svc-row-"]`).filter({ hasText: svcName });
    await expect(svcRow).toBeVisible();

    await toggleRowSwitch(svcRow);
    await page.getByRole("dialog", { name: "Deactivate service" }).getByRole("button", { name: "Deactivate" }).click();
    await expect(svcRow.getByText("Inactive", { exact: true })).toBeVisible();
    // The full-page loading spinner text must never reappear after this in-place update —
    // the search box (unmounted while the spinner is shown) must stay mounted throughout.
    await expect(page.getByPlaceholder(/search by name/i)).toBeVisible();
    await expect(page.getByText("Loading…", { exact: true })).toHaveCount(0);
  });

  test("Bugfix · cambiar filas por página no reemplaza toda la tabla (sin parpadeo), igual que Profesionales", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await page.goto("/app/services");
    const table = page.getByTestId("catalog-items-list");
    await expect(table).toBeVisible();
    const firstRow = page.locator('[data-testid^="svc-row-"]').first();
    await expect(firstRow).toBeVisible();

    // Delay the refetch triggered by the page-size change so the loading window is long
    // enough to deterministically observe whether the table unmounts during it. The page's
    // own fetch is debounced 350ms after the change before the request even fires.
    await page.route("**/api/services/page?**", async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      await route.continue();
    });

    await page.getByRole("combobox", { name: /rows per page/i }).selectOption("25");

    // 600ms: past the 350ms debounce (request now in flight), well before the 800ms route
    // delay resolves. The table (and its rows) must stay mounted here — no blank-out/remount
    // flash — mirroring Profesionales' stale-while-revalidate behavior. `isVisible()` checks
    // the DOM once, synchronously — unlike `expect(...).toBeVisible()`, it does not retry/wait,
    // so it cannot mask a transient unmount that resolves before a retrying assertion would
    // have re-checked.
    await page.waitForTimeout(600);
    expect(await table.isVisible()).toBe(true);
    expect(await firstRow.isVisible()).toBe(true);

    await page.unroute("**/api/services/page?**");
    await expect(table).toBeVisible();
  });
});
