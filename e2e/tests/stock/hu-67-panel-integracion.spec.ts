import { expect, test } from "@playwright/test";

import { loginAs, loginAsPlatformAdmin } from "../../fixtures/auth";
import {
  createProduct,
  outbox,
  pelu,
  peluLogin,
  platformToken,
  proxyMode,
  stockItemByName,
  stockSession,
  waitForOutboxDrained,
} from "../../fixtures/stock/api";
import { getStockWorld } from "../../fixtures/stock/world";

// HU-67 · Panel de integración (Cambio 10).

test.describe.configure({ mode: "serial" });

test.describe("HU-67 · Panel de integración con Stock", () => {
  test.afterEach(async () => {
    await proxyMode("up");
  });

  test("un envío fallido se ve con salón, tipo, intentos y error; Reintentar lo entrega", async ({ page }) => {
    const world = getStockWorld();
    const platform = await platformToken();
    const admin = await peluLogin(world.s2.adminEmail, world.s2.adminPassword);
    await waitForOutboxDrained(platform, world.s2.id);
    const name = `Secador reintento ${Date.now()}`;
    // A non-retryable answer (400) makes the event FAILED right away.
    await proxyMode("fail400", 1);
    await createProduct(admin, world.s2.categoryId, name);
    await expect.poll(async () => (await outbox(platform, world.s2.id, "FAILED")).length, { timeout: 30_000 }).toBe(1);
    const failed = (await outbox(platform, world.s2.id, "FAILED"))[0];

    // Dashboard counter.
    await loginAsPlatformAdmin(page);
    await expect(page.getByTestId("platform-dashboard-stock-failed")).toContainText("Failed deliveries to Stock: 1");

    await page.goto("/platform/stock");
    const row = page.getByTestId(`stock-outbox-row-${failed.id}`);
    await expect(row).toContainText(world.s2.name);
    await expect(row).toContainText("Product");
    await expect(row).toContainText("Failed");
    await expect(row).toContainText("HTTP_400");
    await page.getByTestId(`stock-outbox-retry-${failed.id}`).click();

    await waitForOutboxDrained(platform, world.s2.id);
    const stockToken = await stockSession(world.s2.id);
    expect(await stockItemByName(stockToken, name)).toBeDefined();
  });

  test("Descartar un fallido destraba la cola del salón", async ({ page }) => {
    const world = getStockWorld();
    const platform = await platformToken();
    const admin = await peluLogin(world.s2.adminEmail, world.s2.adminPassword);
    await waitForOutboxDrained(platform, world.s2.id);
    const stamp = Date.now();
    await proxyMode("fail400", 1);
    await createProduct(admin, world.s2.categoryId, `Descartado ${stamp}`);
    await expect.poll(async () => (await outbox(platform, world.s2.id, "FAILED")).length, { timeout: 30_000 }).toBe(1);
    // While FAILED, later events of the salon wait behind it.
    await createProduct(admin, world.s2.categoryId, `Detrás ${stamp}`);
    await new Promise((r) => setTimeout(r, 4000));
    const stockToken = await stockSession(world.s2.id);
    expect(await stockItemByName(stockToken, `Detrás ${stamp}`)).toBeUndefined();

    const failed = (await outbox(platform, world.s2.id, "FAILED"))[0];
    await loginAsPlatformAdmin(page);
    await page.goto("/platform/stock");
    await page.getByTestId(`stock-outbox-discard-${failed.id}`).click();
    await waitForOutboxDrained(platform, world.s2.id);
    await expect.poll(async () => !!(await stockItemByName(stockToken, `Detrás ${stamp}`)), { timeout: 30_000 }).toBe(true);
    expect(await stockItemByName(stockToken, `Descartado ${stamp}`)).toBeUndefined();
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.getByTestId("stock-outbox-empty")).toBeVisible({ timeout: 15_000 });
  });

  test("solo el administrador de plataforma accede al panel", async ({ page }) => {
    const world = getStockWorld();
    const admin = await peluLogin(world.s1.adminEmail, world.s1.adminPassword);
    expect((await pelu("/api/platform/stock/outbox", { token: admin })).status).toBe(403);
    await loginAs(page, world.s1.adminEmail, world.s1.adminPassword);
    await page.goto("/platform/stock");
    await expect(page.getByTestId("stock-outbox-table")).toHaveCount(0);
  });
});
