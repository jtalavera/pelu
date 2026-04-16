import { expect, test } from "@playwright/test";
import { loginAsDemoApi, seedClient } from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

test.describe("HU-10 · Crear cliente", () => {
  test("abre el formulario de nuevo cliente", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/clients");
    await expect(page.getByRole("heading", { name: "Clients" })).toBeVisible();
    await page.getByRole("button", { name: "+ New client" }).first().click();
    await expect(page.getByRole("heading", { name: "New client" })).toBeVisible();
  });

  test("HU-10 · 1 guardar cliente con nombre obligatorio", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/clients");
    const name = `E2E Client ${Date.now()}`;
    await page.getByRole("button", { name: "+ New client" }).first().click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Full name").fill(name);
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  });

  test("HU-10 · 2 RUC inválido muestra mensaje de validación", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/clients");
    await page.getByRole("button", { name: "+ New client" }).first().click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Full name").fill("E2E RUC bad");
    await dlg.getByLabel("RUC").fill("123");
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(
      page.getByText("Invalid RUC. Use digits, one hyphen, and digits (e.g. 80000005-6).", {
        exact: true,
      }),
    ).toBeVisible();
  });

  test("HU-10 · 3 unicidad teléfono: segundo cliente mismo teléfono falla", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const phone = `0981${String(Date.now()).slice(-6)}`;
    await seedClient(request, token, `E2E Dup ${Date.now()}`, phone);

    await loginAsDemo(page);
    await page.goto("/app/clients");
    await page.getByRole("button", { name: "+ New client" }).first().click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Full name").fill("E2E Other");
    await dlg.getByLabel("Phone").fill(phone);
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(
      page.getByText("A client with this phone number already exists.", { exact: true }),
    ).toBeVisible();
  });

  test("HU-10 · 4 cliente disponible en búsqueda de facturación", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const name = `E2E Bill ${Date.now()}`;
    await seedClient(request, token, name);

    await loginAsDemo(page);
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "New Invoice" }).click();
    await page.getByLabel("Search or select client").fill(name.slice(0, 6));
    await page.getByRole("button", { name: name }).click();
    await expect(page.getByText("Selected client", { exact: false })).toContainText(name);
  });

  test("HU-10 · 5 cliente ocasional en factura", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/billing");
    await page.getByRole("tab", { name: "New Invoice" }).click();
    await page.getByLabel("Search or select client").click();
    await page.getByRole("button", { name: "Occasional client" }).click();
    await page.getByLabel("Client display name").fill("Walk-in E2E");
    await expect(page.getByLabel("Client display name")).toHaveValue("Walk-in E2E");
  });
});
