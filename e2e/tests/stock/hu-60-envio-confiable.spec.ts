import { expect, test } from "@playwright/test";

import { loginAs, loginAsPlatformAdmin } from "../../fixtures/auth";
import {
  createProduct,
  kardex,
  onHand,
  outbox,
  peluLogin,
  peluOk,
  platformToken,
  proxyMode,
  stockItemByName,
  stockReceive,
  stockSession,
  waitForOutboxDrained,
} from "../../fixtures/stock/api";
import { issueInvoiceApi, issueInvoiceUi } from "../../fixtures/stock/billing";
import { getStockWorld } from "../../fixtures/stock/world";

// HU-60 · Envío confiable a Stock (Cambio 3): outbox + Service Bus/local wake-up + reconciler.

test.describe.configure({ mode: "serial" });

test.describe("HU-60 · Envío confiable a Stock", () => {
  test.afterEach(async () => {
    await proxyMode("up");
  });

  test("con Stock caído se factura igual; al volver se descuenta una sola vez", async ({ page }) => {
    const world = getStockWorld();
    const admin = await peluLogin(world.s1.adminEmail, world.s1.adminPassword);
    const platform = await platformToken();
    const name = `Cepillo resiliencia ${Date.now()}`;
    const serviceId = await createProduct(admin, world.s1.categoryId, name);
    const stockToken = await stockSession(world.s1.id);
    let itemId = 0;
    await expect.poll(async () => (itemId = (await stockItemByName(stockToken, name))?.id ?? 0), { timeout: 30_000 }).toBeGreaterThan(0);
    await stockReceive(stockToken, itemId, "10");
    await waitForOutboxDrained(platform, world.s1.id);

    await proxyMode("down");
    await loginAs(page, world.s1.adminEmail, world.s1.adminPassword);
    // Invoicing does not wait on (nor fail because of) Stock.
    await issueInvoiceUi(page, [{ serviceId, name, quantity: 2 }]);

    // The sale waits in the outbox with its error, visible in the integration panel.
    await expect
      .poll(async () => (await outbox(platform, world.s1.id)).find((e) => e.eventType === "SALE")?.lastError ?? "", { timeout: 30_000 })
      .toContain("HTTP_503");
    expect(await onHand(stockToken, itemId)).toBe(10);

    await proxyMode("up");
    await waitForOutboxDrained(platform, world.s1.id, 60_000);
    expect(await onHand(stockToken, itemId)).toBe(8);
    expect((await kardex(stockToken, itemId)).filter((r) => r.reasonCode === "SALE")).toHaveLength(1);
  });

  test("en orden: la venta llega antes que su anulación aunque ambas esperaron a Stock", async () => {
    const world = getStockWorld();
    const admin = await peluLogin(world.s1.adminEmail, world.s1.adminPassword);
    const platform = await platformToken();
    const name = `Pinza orden ${Date.now()}`;
    const serviceId = await createProduct(admin, world.s1.categoryId, name);
    const stockToken = await stockSession(world.s1.id);
    let itemId = 0;
    await expect.poll(async () => (itemId = (await stockItemByName(stockToken, name))?.id ?? 0), { timeout: 30_000 }).toBeGreaterThan(0);
    await stockReceive(stockToken, itemId, "5");
    await waitForOutboxDrained(platform, world.s1.id);

    await proxyMode("down");
    const inv = await issueInvoiceApi(admin, [{ serviceId, name, quantity: 1 }]);
    await peluOk(`/api/invoices/${inv.id}/void`, { token: admin, body: { voidReason: "Error de carga" } });
    const pending = await outbox(platform, world.s1.id);
    expect(pending.map((e) => e.eventType)).toEqual(expect.arrayContaining(["SALE", "REVERSE"]));

    await proxyMode("up");
    await waitForOutboxDrained(platform, world.s1.id, 60_000);
    const rows = await kardex(stockToken, itemId);
    const saleIdx = rows.findIndex((r) => r.reasonCode === "SALE");
    const revIdx = rows.findIndex((r) => r.documentType === "REVERSAL");
    expect(saleIdx).toBeGreaterThanOrEqual(0);
    expect(revIdx).toBeGreaterThan(saleIdx);
    expect(await onHand(stockToken, itemId)).toBe(5);
  });

  test("el panel muestra lo pendiente con su error mientras Stock no responde", async ({ page }) => {
    const world = getStockWorld();
    const admin = await peluLogin(world.s2.adminEmail, world.s2.adminPassword);
    const name = `Toalla panel ${Date.now()}`;
    await proxyMode("down");
    await createProduct(admin, world.s2.categoryId, name);
    await loginAsPlatformAdmin(page);
    await page.goto("/platform/stock");
    await expect(page.getByTestId("stock-outbox-table")).toBeVisible();
    await expect(page.getByTestId("stock-outbox-table")).toContainText("HTTP_503", { timeout: 30_000 });
    await expect(page.getByTestId("stock-outbox-table")).toContainText("Product");
    await proxyMode("up");
    await waitForOutboxDrained(await platformToken(), world.s2.id, 60_000);
  });
});
