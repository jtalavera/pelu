import { expect, test } from "@playwright/test";
import { apiPostJson, loginAsDemoApi } from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

test.describe("HU-21 · Fixes varios clientes", () => {
  test("HU-21 · 9 acción en listado muestra menú kebab (Actions) en fila", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const fullName = `E2E Kebab ${Date.now()}`;
    await apiPostJson(request, token, "/api/clients", {
      fullName,
      phone: null,
      email: null,
      ruc: null,
    });
    await loginAsDemo(page);
    await page.goto("/app/clients");
    await page.locator("#clients-inline-search").fill(fullName);
    const crow = page.getByRole("row").filter({ hasText: fullName }).first();
    await expect(crow).toBeVisible({ timeout: 20_000 });
    await expect(crow.getByRole("button", { name: /^(Actions|Acciones)$/ })).toBeVisible();
  });

  test("HU-21 · 9 kebab muestra Editar información y Desactivar cliente", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const fullName = `E2E KebabItems ${Date.now()}`;
    const created = await apiPostJson<{ id: number }>(request, token, "/api/clients", {
      fullName,
      phone: null,
      email: null,
      ruc: null,
    });
    await loginAsDemo(page);
    await page.goto("/app/clients");
    await page.locator("#clients-inline-search").fill(fullName);
    await expect(page.getByTestId(`clients-row-${created.id}-trigger`)).toBeVisible({ timeout: 20_000 });
    await page.getByTestId(`clients-row-${created.id}-trigger`).click();
    await expect(page.getByRole("menuitem", { name: "Edit information" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Deactivate client" })).toBeVisible();
  });

  test("HU-21 · 8 botón Cancelar en edición vuelve al listado", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const c = await apiPostJson<{ id: number }>(request, token, "/api/clients", {
      fullName: `E2E Cancel ${Date.now()}`,
      phone: null,
      email: null,
      ruc: null,
    });
    await loginAsDemo(page);
    await page.goto(`/app/clients/${c.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#detail-phone")).toBeVisible({ timeout: 25_000 });
    await expect(page.getByTestId("client-edit-cancel")).toBeVisible();
    await page.locator("#detail-phone").fill("0981123456");
    await page.getByTestId("client-edit-cancel").click();
    await expect(page).toHaveURL(/\/app\/clients\/?$/);
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
    // Issue #163 AC4: confirming shows a success message in the client detail view,
    // same style as updating the client.
    await page
      .getByRole("dialog", { name: "Deactivate client" })
      .getByRole("button", { name: "Deactivate" })
      .click();
    await expect(page.getByText("Client deactivated successfully.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reactivate" })).toBeVisible();
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
    // Issue #163 AC4: reactivating shows a success message in the client detail view.
    await expect(page.getByText("Client reactivated successfully.", { exact: true })).toBeVisible();
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
    await page.locator("#clients-inline-search").fill(name);
    // Names are stored in UPPERCASE (issue #155 AC3), regardless of the case sent here.
    await expect(page.getByText(name.toUpperCase(), { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Inactive", { exact: true }).first()).toBeVisible();
  });

  test("Issue #163 · AC5 desactivar y reactivar desde el listado muestra mensaje de éxito", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const fullName = `E2E RowStatus ${Date.now()}`;
    const created = await apiPostJson<{ id: number }>(request, token, "/api/clients", {
      fullName,
      phone: null,
      email: null,
      ruc: null,
    });

    await loginAsDemo(page);
    await page.goto("/app/clients");
    await page.locator("#clients-inline-search").fill(fullName);
    await expect(page.getByTestId(`clients-row-${created.id}-trigger`)).toBeVisible({ timeout: 20_000 });

    await page.getByTestId(`clients-row-${created.id}-trigger`).click();
    await page.getByRole("menuitem", { name: "Deactivate client" }).click();
    await page
      .getByRole("dialog", { name: "Deactivate client" })
      .getByRole("button", { name: "Deactivate" })
      .click();
    await expect(page.getByText("Client deactivated successfully.", { exact: true })).toBeVisible();

    await page.getByTestId(`clients-row-${created.id}-trigger`).click();
    await page.getByRole("menuitem", { name: "Reactivate client" }).click();
    await expect(page.getByText("Client activated successfully.", { exact: true })).toBeVisible();
  });

  // Issue #163 AC6: the success/error message block above the search toolbar carries its own
  // margin so it never sits flush against the search bar.
  test("Issue #163 · AC6 el mensaje de éxito al crear cliente deja espacio antes del buscador", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await page.goto("/app/clients");
    const name = `E2E Spacing ${Date.now()}`;
    await page.getByRole("button", { name: "+ New client" }).first().click();
    await page.getByLabel("Full name").fill(name);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const alert = page.getByText("The client was created successfully.", { exact: true });
    await expect(alert).toBeVisible();
    const search = page.locator("#clients-inline-search");
    await expect(search).toBeVisible();
    const gap = await page.evaluate(() => {
      const alertEl = document.querySelector('[role="alert"]');
      const searchEl = document.getElementById("clients-inline-search");
      if (!alertEl || !searchEl) return null;
      const a = alertEl.getBoundingClientRect();
      const s = searchEl.getBoundingClientRect();
      return s.top - a.bottom;
    });
    expect(gap).not.toBeNull();
    expect(gap as number).toBeGreaterThan(8);
  });
});
