import { expect, test } from "@playwright/test";
import { apiPostJson, loginAsDemoApi } from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

test.describe("HU-21 · Fixes varios clientes", () => {
  test("HU-21 · 9 cada fila del listado tiene un interruptor activo/inactivo (sin menú kebab)", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const fullName = `E2E Switch ${Date.now()}`;
    const created = await apiPostJson<{ id: number }>(request, token, "/api/clients", {
      fullName,
      phone: null,
      email: null,
      ruc: null,
    });
    await loginAsDemo(page);
    await page.goto("/app/clients");
    await page.locator("#clients-inline-search").fill(fullName);
    const row = page.getByTestId(`client-row-${created.id}`);
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId(`client-switch-${created.id}`)).toBeChecked();
    await expect(row.getByRole("button", { name: /^(Actions|Acciones)$/ })).toHaveCount(0);
  });

  test("HU-21 · 9 desactivar desde el interruptor del listado pide confirmación", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const fullName = `E2E SwitchConfirm ${Date.now()}`;
    const created = await apiPostJson<{ id: number }>(request, token, "/api/clients", {
      fullName,
      phone: null,
      email: null,
      ruc: null,
    });
    await loginAsDemo(page);
    await page.goto("/app/clients");
    await page.locator("#clients-inline-search").fill(fullName);
    await expect(page.getByTestId(`client-switch-${created.id}`)).toBeVisible({ timeout: 20_000 });
    await page.getByTestId(`client-switch-${created.id}`).dispatchEvent("click");
    await expect(page.getByRole("dialog", { name: "Deactivate client" })).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId(`client-switch-${created.id}`)).toBeChecked();
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
    await page.getByTestId("client-active-switch").dispatchEvent("click");
    await expect(page.getByRole("dialog", { name: "Deactivate client" })).toBeVisible();
    // Issue #163 AC4: confirming goes back to the list with a success toast.
    await page
      .getByRole("dialog", { name: "Deactivate client" })
      .getByRole("button", { name: "Deactivate" })
      .click();
    await expect(page).toHaveURL(/\/app\/clients\/?$/);
    await expect(page.getByText("Client deactivated successfully.", { exact: true })).toBeVisible();
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
    await expect(page.getByTestId("client-active-label")).toHaveText("Inactive");
    // Reactivating is direct (no confirmation) and returns to the list with a success toast.
    await page.getByTestId("client-active-switch").dispatchEvent("click");
    await expect(page).toHaveURL(/\/app\/clients\/?$/);
    await expect(page.getByText("Client activated successfully.", { exact: true })).toBeVisible();
  });

  test("HU-21 · 6 filtro Todos incluye inactivos en el listado", async ({ page, request }) => {
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
    await page.getByTestId("clients-filter-all").click();
    await page.locator("#clients-inline-search").fill(name);
    // Names are stored in UPPERCASE (issue #155 AC3), regardless of the case sent here.
    const row = page.getByTestId(`client-row-${c.id}`);
    await expect(row).toContainText(name.toUpperCase());
    await expect(row).toContainText("Inactive");
    await expect(row).toHaveAttribute("data-active", "false");
    await expect(page.getByTestId(`client-switch-${c.id}`)).not.toBeChecked();
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
    await expect(page.getByTestId(`client-switch-${created.id}`)).toBeVisible({ timeout: 20_000 });

    await page.getByTestId(`client-switch-${created.id}`).dispatchEvent("click");
    await page
      .getByRole("dialog", { name: "Deactivate client" })
      .getByRole("button", { name: "Deactivate" })
      .click();
    await expect(page.getByText("Client deactivated successfully.", { exact: true })).toBeVisible();

    // Wait for the list to reload before flipping it back (reactivating is direct).
    await expect(page.getByTestId(`client-switch-${created.id}`)).not.toBeChecked();
    await page.getByTestId(`client-switch-${created.id}`).dispatchEvent("click");
    await expect(page.getByText("Client activated successfully.", { exact: true })).toBeVisible();
  });

  // Issue #163 AC6: the success/error message block above the search toolbar carries its own
  // margin so it never sits flush against the search bar.
  // Issue #163 AC6 (redesign): the creation result is a toast that closes the dialog's form; the
  // list below stays untouched and the search bar stays reachable.
  test("Issue #163 · AC6 al crear un cliente aparece un aviso de éxito y el buscador sigue accesible", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await page.goto("/app/clients");
    const name = `E2E Spacing ${Date.now()}`;
    await page.getByRole("button", { name: "+ New client" }).first().click();
    await page.getByLabel("Full name").fill(name);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByTestId("clients-toast")).toContainText("The client was created successfully.");
    await expect(page.locator("#clients-inline-search")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  // El foco se posiciona en el cuadro de mensajes al terminar de guardar para que el usuario
  // verifique el resultado de inmediato.
  test("Guardar cliente nuevo muestra el aviso de resultado a la vista", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/clients");
    await page.getByRole("button", { name: "+ New client" }).first().click();
    await page.getByLabel("Full name").fill(`E2E Focus ${Date.now()}`);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const toast = page.getByTestId("clients-toast");
    await expect(toast).toContainText("The client was created successfully.");
    await expect(toast).toBeInViewport();
  });

  test("Guardar edición en el perfil vuelve al listado con el aviso de resultado a la vista", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const c = await apiPostJson<{ id: number }>(request, token, "/api/clients", {
      fullName: `E2E Focus Edit ${Date.now()}`,
      phone: null,
      email: null,
      ruc: null,
    });
    await loginAsDemo(page);
    await page.goto(`/app/clients/${c.id}`);
    await page.locator("#detail-phone").fill(`097${String(Date.now()).slice(-7)}`);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const toast = page.getByTestId("clients-toast");
    await expect(toast).toContainText("Client updated successfully.");
    await expect(toast).toBeInViewport();
  });
});
