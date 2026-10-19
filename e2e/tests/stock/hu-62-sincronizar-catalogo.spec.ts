import { expect, test } from "@playwright/test";

import { loginAs, loginAsPlatformAdmin } from "../../fixtures/auth";
import {
  createProduct,
  pelu,
  peluLogin,
  peluOk,
  platformToken,
  productosXlsx,
  stockItemByName,
  stockSession,
} from "../../fixtures/stock/api";
import { getStockWorld } from "../../fixtures/stock/world";

// HU-62 · Sincronizar catálogo (Cambio 5) — y el criterio de verificación "Upload de productos →
// aparecen en Stock" (solo después de «Sincronizar catálogo con Stock»; el upload no sincroniza solo).

test.describe("HU-62 · Sincronizar catálogo", () => {
  // The platform upload never syncs to Stock on its own: the imported products reach Stock only
  // after the Platform Admin runs "Sincronizar catálogo con Stock".
  test("un upload de productos NO se envía solo a Stock; llegan al sincronizar el catálogo", async ({ page }) => {
    const world = getStockWorld();
    const stamp = Date.now();
    const file = await productosXlsx([
      { categoria: "Productos", nombre: `Ampolla capilar ${stamp}`, precio: 30000, sku: `AC-${stamp}` },
      { categoria: "Productos", nombre: `Sérum ${stamp}`, precio: 60000 },
    ]);
    await loginAsPlatformAdmin(page);
    await page.goto("/platform/import");
    await page.getByTestId("import-tab-products").click();
    await page.locator("#import-run-tenant-products").selectOption({ value: String(world.s1.id) });
    await page.locator("#import-run-file-products").setInputFiles({
      name: "productos.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: file,
    });
    await page.getByRole("button", { name: "Import" }).click();
    await expect(page.getByTestId("import-run-summary-products")).toContainText("2 of 2 rows imported. 0 failed.");

    const stockToken = await stockSession(world.s1.id);
    await page.waitForTimeout(5000);
    expect(await stockItemByName(stockToken, `Ampolla capilar ${stamp}`)).toBeUndefined();
    expect(await stockItemByName(stockToken, `Sérum ${stamp}`)).toBeUndefined();

    await peluOk(`/api/platform/tenants/${world.s1.id}/stock/catalog-sync`, { token: await platformToken(), body: {} });
    await expect.poll(async () => (await stockItemByName(stockToken, `Ampolla capilar ${stamp}`))?.sku, { timeout: 30_000 }).toBe(`AC-${stamp}`);
    await expect.poll(async () => !!(await stockItemByName(stockToken, `Sérum ${stamp}`)), { timeout: 30_000 }).toBe(true);
  });

  test("crear, editar, desactivar y reactivar un Producto en Femme llega solo a Stock (nombre y activo)", async ({
    page,
  }) => {
    const world = getStockWorld();
    const token = await peluLogin(world.s1.adminEmail, world.s1.adminPassword);
    const stockToken = await stockSession(world.s1.id);
    const stamp = Date.now();
    const name = `Gel fijador ${stamp}`;
    const id = await createProduct(token, world.s1.categoryId, name);
    await expect.poll(async () => (await stockItemByName(stockToken, name))?.active, { timeout: 30_000 }).toBe(true);

    // Edit from the Services screen.
    await loginAs(page, world.s1.adminEmail, world.s1.adminPassword);
    await page.goto("/app/services");
    await page.getByTestId(`svc-row-${id}`).click();
    await page.locator("#svc-name").fill(`${name} extra fuerte`);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(async () => !!(await stockItemByName(stockToken, `${name} extra fuerte`)), { timeout: 30_000 }).toBe(true);

    await peluOk(`/api/services/${id}/deactivate`, { token, body: {} });
    await expect.poll(async () => (await stockItemByName(stockToken, `${name} extra fuerte`))?.active, { timeout: 30_000 }).toBe(false);
    await peluOk(`/api/services/${id}/activate`, { token, body: {} });
    await expect.poll(async () => (await stockItemByName(stockToken, `${name} extra fuerte`))?.active, { timeout: 30_000 }).toBe(true);

    // A plain service never reaches Stock.
    const serviceName = `Brushing ${stamp}`;
    await pelu("/api/services", {
      token,
      body: { name: serviceName, categoryId: world.s1.serviceCategoryId, priceMinor: 30000, durationMinutes: 30 },
    });
    await page.waitForTimeout(3000);
    expect(await stockItemByName(stockToken, serviceName)).toBeUndefined();
  });

  test("la ficha del salón muestra la última sincronización y el botón 'Sincronizar catálogo con Stock'", async ({
    page,
  }) => {
    const world = getStockWorld();
    await loginAsPlatformAdmin(page);
    await page.goto("/platform/tenants");
    await page.locator("#platform-tenants-search").fill(world.s1.name);
    await page.locator("#platform-tenants-search").press("Enter");
    await page.getByTestId(`platform-tenant-row-${world.s1.id}`).click();
    const section = page.getByTestId("tenant-stock-section");
    await expect(section).toBeVisible();
    await expect(page.getByTestId("tenant-stock-last-sync")).toContainText("Last catalog sync:");
    await expect(page.getByTestId("tenant-stock-last-sync")).not.toContainText("never");
    const platform = await platformToken();
    const status = () =>
      peluOk<{ catalogSyncedAt: string }>(`/api/platform/tenants/${world.s1.id}/stock`, { token: platform });
    const before = (await status()).catalogSyncedAt;

    await page.getByTestId("tenant-stock-catalog-sync").click();
    await expect(page.getByTestId("tenant-stock-sync-requested")).toBeVisible();
    // The full sync is delivered and the date moves forward.
    await expect
      .poll(async () => new Date((await status()).catalogSyncedAt).getTime(), { timeout: 30_000 })
      .toBeGreaterThan(new Date(before).getTime());

    // A salon without Stock has no Stock block at all.
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.locator("#platform-tenants-search").fill(world.s3.name);
    await page.locator("#platform-tenants-search").press("Enter");
    await page.getByTestId(`platform-tenant-row-${world.s3.id}`).click();
    await expect(page.locator("#tenant-edit-tier")).toBeVisible();
    await expect(page.getByTestId("tenant-stock-section")).toHaveCount(0);
    // …and the endpoint refuses it.
    const refused = await pelu(`/api/platform/tenants/${world.s3.id}/stock/catalog-sync`, {
      token: platform,
      body: {},
    });
    expect(refused.status).toBe(409);
    expect(refused.text).toContain("STOCK_MODULE_DISABLED");
  });
});
