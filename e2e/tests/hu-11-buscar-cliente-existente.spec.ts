import { expect, test } from "@playwright/test";
import { apiPostJson, loginAsDemoApi, seedClient } from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

test.describe("HU-11 · Buscar cliente existente", () => {
  test("listado de clientes con búsqueda", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/clients");
    await expect(page.getByPlaceholder("Search by name, phone, or RUC…").first()).toBeVisible();
  });

  test("HU-11 · 2 búsqueda incremental con 2+ caracteres filtra resultados", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const unique = `ZzE2E${Date.now()}`;
    // Client names are stored uppercased by the backend (issue-155) regardless of
    // the case they're submitted in.
    const alphaName = `${unique} Alpha`.toUpperCase();
    const betaName = `${unique} Beta`.toUpperCase();
    await seedClient(request, token, `${unique} Alpha`);
    await seedClient(request, token, `${unique} Beta`);

    await loginAsDemo(page);
    await page.goto("/app/clients");
    const search = page.getByPlaceholder("Search by name, phone, or RUC…").first();
    await search.fill(unique.slice(0, 2));
    await expect(page.getByText(alphaName, { exact: true })).toBeVisible();
    await expect(page.getByText(betaName, { exact: true })).toBeVisible();
    await search.fill(`${unique} Alpha`);
    await expect(page.getByText(alphaName, { exact: true })).toBeVisible();
    await expect(page.getByText(betaName, { exact: true })).toHaveCount(0);
  });

  test("HU-11 · 3 resultados muestran teléfono y RUC cuando existen", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const name = `E2E Meta ${Date.now()}`;
    const phone = `098${String(Date.now()).slice(-7)}`;
    const ruc = `8${String(Date.now()).slice(-5)}-6`;
    await apiPostJson(request, token, "/api/clients", {
      fullName: name,
      phone,
      email: null,
      ruc,
    });

    await loginAsDemo(page);
    await page.goto("/app/clients");
    await page.getByPlaceholder("Search by name, phone, or RUC…").first().fill(name);
    await expect(page.getByText(phone, { exact: true })).toBeVisible();
    await expect(page.getByText(ruc, { exact: true })).toBeVisible();
  });
});
