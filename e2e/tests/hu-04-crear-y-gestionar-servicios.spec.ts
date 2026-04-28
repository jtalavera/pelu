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
    await svcDialog.getByLabel("Duration (minutes)").fill("45");
    await svcDialog.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(svcName, { exact: true }).first()).toBeVisible();
  });

  test("HU-04 · 3 edición de servicio", async ({ page }) => {
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
    await newDlg.getByLabel("Duration (minutes)").fill("30");
    await newDlg.getByRole("button", { name: "Save" }).click();
    await page.getByPlaceholder("Search by name or category…").fill(original);
    await page
      .locator("div")
      .filter({ hasText: original })
      .getByRole("button", { name: "Edit", exact: true })
      .click();
    const renamed = `${original} renamed`;
    const nameInput = page.locator('input[id^="svc-inline-name-"]');
    await nameInput.fill(renamed);
    await nameInput.press("Enter");
    await expect(page.getByText(renamed, { exact: true }).first()).toBeVisible();
  });

  test("HU-04 · 5 búsqueda y filtro por categoría", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/services");
    await page.getByPlaceholder("Search by name or category…").fill("zzzznonexistent");
    await expect(page.getByText("No rows match your filter.")).toBeVisible();
    await page.getByPlaceholder("Search by name or category…").clear();
  });
});
