import { expect, test } from "@playwright/test";
import { loginAsDemo } from "../fixtures/auth";

test.describe("HU-04 · Crear y gestionar servicios", () => {


  test("HU-04 · 1 CRUD categoría: crear y listar", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/services");
    await page.getByRole("button", { name: "Categories", exact: true }).click();
    const name = `E2E Cat ${Date.now()}`;
    await page.getByRole("button", { name: "+ New category" }).click();
    await page.getByRole("dialog", { name: "New category" }).getByLabel("Name").fill(name);
    await page.getByRole("dialog", { name: "New category" }).getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  });

  test("HU-04 · 2 alta de servicio con categoría", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/services");
    await page.getByRole("button", { name: "Categories", exact: true }).click();
    const cat = `SvcCat ${Date.now()}`;
    await page.getByRole("button", { name: "+ New category" }).click();
    await page.getByRole("dialog", { name: "New category" }).getByLabel("Name").fill(cat);
    await page.getByRole("dialog", { name: "New category" }).getByRole("button", { name: "Save" }).click();
    await page.getByRole("button", { name: "Services", exact: true }).click();
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
    await expect(svcRow.getByText("Gs. 50.000", { exact: true })).toBeVisible();
    // Issue #163 AC7: the services table has its own Status column, same as Professionals.
    await expect(svcRow.getByText("Active", { exact: true })).toBeVisible();
  });

  test("Issue #163/#165 · AC8/AC9 desactivar y reactivar servicio: sin tachado ni fondo apagado, badge de estado, mensaje de éxito", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await page.goto("/app/services");
    await page.getByRole("button", { name: "Categories", exact: true }).click();
    const cat = `DeactCat ${Date.now()}`;
    await page.getByRole("button", { name: "+ New category" }).click();
    await page.getByRole("dialog", { name: "New category" }).getByLabel("Name").fill(cat);
    await page.getByRole("dialog", { name: "New category" }).getByRole("button", { name: "Save" }).click();
    await page.getByRole("button", { name: "Services", exact: true }).click();
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
    const activeBackground = await svcRow.evaluate((el) => getComputedStyle(el).backgroundColor);

    await svcRow.getByRole("button", { name: /^(Actions|Acciones)$/ }).click();
    await page.getByRole("menuitem", { name: "Deactivate" }).click();
    await page.getByRole("dialog", { name: "Deactivate service" }).getByRole("button", { name: "Deactivate" }).click();
    await expect(svcRow.getByText("Inactive", { exact: true })).toBeVisible();
    // AC8: status changes via badge, the service name is never struck through.
    await expect(svcRow).not.toHaveClass(/card-inactive/);
    const nameDecoration = await svcRow
      .getByText(svcName, { exact: true })
      .evaluate((el) => getComputedStyle(el).textDecorationLine);
    expect(nameDecoration).toBe("none");
    // Issue #165 AC2: the row must NOT get a dimmed/grayed-out background either — only
    // the Status badge should signal inactive, same as the Clients table.
    await expect(svcRow).not.toHaveClass(/row-inactive/);
    const inactiveBackground = await svcRow.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(inactiveBackground).toBe(activeBackground);
    // AC9: deactivating from the table shows a success message in the table header.
    await expect(page.getByText("Service deactivated successfully.", { exact: true })).toBeVisible();

    await svcRow.getByRole("button", { name: /^(Actions|Acciones)$/ }).click();
    await page.getByRole("menuitem", { name: "Activate" }).click();
    await expect(svcRow.getByText("Active", { exact: true })).toBeVisible();
    await expect(page.getByText("Service activated successfully.", { exact: true })).toBeVisible();
  });

  test("HU-04 · 3+6 edición de servicio vía pop-up al hacer click en la fila", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/services");
    await page.getByRole("button", { name: "Categories", exact: true }).click();
    const cat = `EditCat ${Date.now()}`;
    await page.getByRole("button", { name: "+ New category" }).click();
    await page.getByRole("dialog", { name: "New category" }).getByLabel("Name").fill(cat);
    await page.getByRole("dialog", { name: "New category" }).getByRole("button", { name: "Save" }).click();
    await page.getByRole("button", { name: "Services", exact: true }).click();
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
    await page.getByRole("button", { name: "Categories", exact: true }).click();
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

  test("Issue #68 · filtros de categoría aparecen antes que los de estado, y el botón 'Todos' dice 'All statuses'", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await page.goto("/app/services");

    const filtersContainer = page.locator('[data-tour="services-filters"]');
    await expect(filtersContainer).toBeVisible();

    // The status "all" filter must read "All statuses", not just "All"
    await expect(
      filtersContainer.getByRole("button", { name: "All statuses", exact: true }),
    ).toBeVisible();

    // Category filter buttons must render before the status filter group in DOM order
    const catBeforeStatus = await filtersContainer.evaluate((container) => {
      const catBtn = Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === "All categories",
      );
      const statusGroup = container.querySelector('[role="group"]');
      if (!catBtn || !statusGroup) return false;
      return (
        (catBtn.compareDocumentPosition(statusGroup) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
      );
    });
    expect(catBeforeStatus).toBe(true);
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
      const table = document.querySelector("table");
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

    await svcRow.getByRole("button", { name: /^(Actions|Acciones)$/ }).click();
    await page.getByRole("menuitem", { name: "Deactivate" }).click();
    await page.getByRole("dialog", { name: "Deactivate service" }).getByRole("button", { name: "Deactivate" }).click();
    await expect(svcRow.getByText("Inactive", { exact: true })).toBeVisible();
    // The full-page loading spinner text must never reappear after this in-place update —
    // the search box (unmounted while the spinner is shown) must stay mounted throughout.
    await expect(page.getByPlaceholder(/search by name/i)).toBeVisible();
    await expect(page.getByText("Loading…", { exact: true })).toHaveCount(0);
  });
});
