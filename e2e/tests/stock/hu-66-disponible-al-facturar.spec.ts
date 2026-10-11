import { expect, test } from "@playwright/test";

import { loginAs } from "../../fixtures/auth";
import { clickIssueInvoiceAndExpectSuccess, pickServiceLine } from "../../fixtures/invoice";
import {
  createProduct,
  onHand,
  peluLogin,
  proxyMode,
  stockAlerts,
  stockItemByName,
  stockReceive,
  stockSession,
} from "../../fixtures/stock/api";
import { fillNewInvoiceUi } from "../../fixtures/stock/billing";
import { getStockWorld } from "../../fixtures/stock/world";

// HU-66 · Disponible al facturar (Cambio 9).

test.describe.configure({ mode: "serial" });

test.describe("HU-66 · Disponible al facturar", () => {
  test.afterEach(async () => {
    await proxyMode("up");
  });

  test("muestra el disponible; por encima, aviso ámbar que no bloquea y queda en negativo con alerta", async ({ page }) => {
    const world = getStockWorld();
    const admin = await peluLogin(world.s1.adminEmail, world.s1.adminPassword);
    const name = `Laca disponible ${Date.now()}`;
    const serviceId = await createProduct(admin, world.s1.categoryId, name);
    const stockToken = await stockSession(world.s1.id);
    let itemId = 0;
    await expect.poll(async () => (itemId = (await stockItemByName(stockToken, name))?.id ?? 0), { timeout: 30_000 }).toBeGreaterThan(0);
    await stockReceive(stockToken, itemId, "3");

    await loginAs(page, world.s1.adminEmail, world.s1.adminPassword);
    await fillNewInvoiceUi(page, [{ serviceId, name, quantity: 1 }]);
    await expect(page.getByTestId("line-stock-0")).toHaveText("Available: 3");

    await page.locator("#line-qty-0").fill("5");
    await page.locator("#pay-amount-0").fill("250000");
    const warning = page.getByTestId("line-stock-0-warning");
    await expect(warning).toContainText("Available: 3 — stock will go negative");
    // Amber, not blocking.
    await expect(warning).toHaveClass(/amber/);
    await clickIssueInvoiceAndExpectSuccess(page);

    await expect.poll(() => onHand(stockToken, itemId), { timeout: 30_000 }).toBe(-2);
    await expect
      .poll(async () => (await stockAlerts(stockToken, "NEGATIVE_STOCK")).some((a) => a.itemId === itemId), { timeout: 30_000 })
      .toBe(true);
  });

  test("con formato es-PY y en español", async ({ page }) => {
    const world = getStockWorld();
    const admin = await peluLogin(world.s1.adminEmail, world.s1.adminPassword);
    const name = `Gomina miles ${Date.now()}`;
    const serviceId = await createProduct(admin, world.s1.categoryId, name);
    const stockToken = await stockSession(world.s1.id);
    let itemId = 0;
    await expect.poll(async () => (itemId = (await stockItemByName(stockToken, name))?.id ?? 0), { timeout: 30_000 }).toBeGreaterThan(0);
    await stockReceive(stockToken, itemId, "1500");
    await loginAs(page, world.s1.adminEmail, world.s1.adminPassword);
    await fillNewInvoiceUi(page, [{ serviceId, name, quantity: 1 }]);
    await expect(page.getByTestId("line-stock-0")).toHaveText("Available: 1.500");
    // Changing the language resets the draft: pick the product again, now in Spanish.
    await page.getByRole("button", { name: "ES", exact: true }).click();
    await pickServiceLine(page, name, 0);
    await expect(page.getByTestId("line-stock-0")).toHaveText("Disponible: 1.500");
  });

  test("si Stock no responde no se muestra nada y se factura normal", async ({ page }) => {
    const world = getStockWorld();
    const admin = await peluLogin(world.s1.adminEmail, world.s1.adminPassword);
    const name = `Cera sin stock ${Date.now()}`;
    const serviceId = await createProduct(admin, world.s1.categoryId, name);
    await proxyMode("down");
    await loginAs(page, world.s1.adminEmail, world.s1.adminPassword);
    await fillNewInvoiceUi(page, [{ serviceId, name, quantity: 1 }]);
    await page.waitForTimeout(2000);
    await expect(page.getByTestId("line-stock-0")).toHaveCount(0);
    await expect(page.getByTestId("line-stock-0-warning")).toHaveCount(0);
    await clickIssueInvoiceAndExpectSuccess(page);
  });
});
