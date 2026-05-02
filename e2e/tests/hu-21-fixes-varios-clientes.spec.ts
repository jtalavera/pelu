import { expect, test } from "@playwright/test";
import { apiPostJson, loginAsDemoApi } from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

test.describe("HU-21 · Fixes varios clientes", () => {
  test("HU-21 · acción en listado muestra botón More… en fila", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await apiPostJson(request, token, "/api/clients", {
      fullName: `E2E MoreBtn ${Date.now()}`,
      phone: null,
      email: null,
      ruc: null,
    });
    await loginAsDemo(page);
    await page.goto("/app/clients");
    await expect(
      page.getByRole("button", { name: "More…", exact: true }).first(),
    ).toBeVisible();
  });

  test("HU-21 · 1 botón Nuevo cliente visible", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/clients");
    await expect(page.getByRole("button", { name: "+ New client" }).first()).toBeVisible();
  });

  test("HU-21 · 3 una sola alerta de éxito al guardar edición en perfil", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const c = await apiPostJson<{ id: number }>(request, token, "/api/clients", {
      fullName: `E2E Toast ${Date.now()}`,
      phone: null,
      email: null,
      ruc: null,
    });

    const phone = `097${String(Date.now()).slice(-7)}`;
    await loginAsDemo(page);
    await page.goto(`/app/clients/${c.id}`);
    await page.locator("#detail-phone").fill(phone);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Client updated successfully.", { exact: true })).toHaveCount(1);
  });

  test("HU-21 · 4 desactivar usa modal de confirmación", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const c = await apiPostJson<{ id: number }>(request, token, "/api/clients", {
      fullName: `E2E Deact ${Date.now()}`,
      phone: null,
      email: null,
      ruc: null,
    });

    await loginAsDemo(page);
    await page.goto(`/app/clients/${c.id}`);
    await page.getByRole("button", { name: "Deactivate" }).click();
    await expect(page.getByRole("heading", { name: "Deactivate client" })).toBeVisible();
  });

  test("HU-21 · 5 reactivar cliente inactivo", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const c = await apiPostJson<{ id: number }>(request, token, "/api/clients", {
      fullName: `E2E React ${Date.now()}`,
      phone: null,
      email: null,
      ruc: null,
    });
    await apiPostJson(request, token, `/api/clients/${c.id}/deactivate`, {});

    await loginAsDemo(page);
    await page.goto(`/app/clients/${c.id}`);
    await page.getByRole("button", { name: "Reactivate" }).click();
    await expect(page.getByRole("button", { name: "Deactivate" })).toBeVisible();
  });

  test("HU-21 · 6 filtro Todas incluye inactivos en el listado", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const name = `E2E Inact ${Date.now()}`;
    const c = await apiPostJson<{ id: number }>(request, token, "/api/clients", {
      fullName: name,
      phone: null,
      email: null,
      ruc: null,
    });
    await apiPostJson(request, token, `/api/clients/${c.id}/deactivate`, {});

    await loginAsDemo(page);
    await page.goto("/app/clients");
    await page.getByRole("button", { name: "All" }).click();
    await page.getByPlaceholder("Search by name, phone, or RUC…").first().fill(name);
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Inactive", { exact: true }).first()).toBeVisible();
  });
});
