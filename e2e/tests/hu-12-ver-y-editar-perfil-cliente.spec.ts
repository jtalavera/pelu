import { expect, test } from "@playwright/test";
import { apiPostJson, loginAsDemoApi } from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

test.describe("HU-12 · Ver y editar perfil de cliente", () => {
  test("ruta de detalle responde (404 controlado si no hay id)", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/clients/999999");
    await expect(page.getByText("Could not load client profile.")).toBeVisible();
  });

  test("HU-12 · 1 y 2 listado y columnas visibles", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const name = `E2E Prof ${Date.now()}`;
    await apiPostJson(request, token, "/api/clients", {
      fullName: name,
      phone: "0981999888",
      email: null,
      ruc: null,
    });

    await loginAsDemo(page);
    await page.goto("/app/clients");
    await page.getByPlaceholder("Search by name, phone, or RUC…").first().fill(name);
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
    await expect(page.getByText("0981999888", { exact: true })).toBeVisible();
    await expect(page.getByText("No RUC", { exact: true }).first()).toBeVisible();
  });

  test("HU-12 · 3 perfil e historial (pestañas)", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const c = await apiPostJson<{ id: number }>(request, token, "/api/clients", {
      fullName: `E2E Tabs ${Date.now()}`,
      phone: null,
      email: null,
      ruc: null,
    });

    await loginAsDemo(page);
    await page.goto(`/app/clients/${c.id}`);
    await expect(page.getByRole("heading", { name: /E2E Tabs/ })).toBeVisible();
    await page.getByRole("tab", { name: "History" }).click();
    await expect(page.getByText("No appointments on record.", { exact: true })).toBeVisible();
  });

  test("HU-12 · 4 edición con validación RUC", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const c = await apiPostJson<{ id: number }>(request, token, "/api/clients", {
      fullName: `E2E Val ${Date.now()}`,
      phone: null,
      email: null,
      ruc: null,
    });

    await loginAsDemo(page);
    await page.goto(`/app/clients/${c.id}`);
    await page.locator("#detail-ruc").fill("bad");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByText("Invalid RUC. Use digits, one hyphen, and digits (e.g. 80000005-6).", {
        exact: true,
      }),
    ).toBeVisible();
  });
});
