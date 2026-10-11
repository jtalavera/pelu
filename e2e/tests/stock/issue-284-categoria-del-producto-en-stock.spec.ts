import { expect, test } from "@playwright/test";

import {
  createCategory,
  createProduct,
  peluLogin,
  platformToken,
  stock,
  stockSession,
  waitForOutboxDrained,
  waitForStockSession,
} from "../../fixtures/stock/api";
import { getStockWorld } from "../../fixtures/stock/world";

// Issue #284 · ajuste 1: al migrar un producto de Pelu a Stock viaja con la categoría que tiene en
// Pelu. Pelu y Stock NO comparten tabla de categorías: Pelu envía el NOMBRE de la categoría y Stock
// la resuelve en su propia tabla (ItemCategory).

async function stockItemRaw(token: string, name: string): Promise<unknown | undefined> {
  const r = await stock<{ content: Array<{ name: string }> }>(
    `/api/v1/items?size=200&q=${encodeURIComponent(name)}`,
    { token },
  );
  return (r.body?.content ?? []).find((i) => i.name === name);
}

test.describe("Issue #284 · la categoría del producto viaja a Stock", () => {
  test("el producto llega a Stock con el nombre de su categoría de Pelu", async () => {
    const world = getStockWorld();
    const platform = await platformToken();
    const admin = await peluLogin(world.s1.adminEmail, world.s1.adminPassword);
    await waitForStockSession(world.s1.id);
    await waitForOutboxDrained(platform, world.s1.id);

    const stamp = Date.now();
    const categoryName = `Insumos ${stamp}`;
    const categoryId = await createCategory(admin, categoryName, "PRODUCT");
    const productName = `Tinte categoría ${stamp}`;
    await createProduct(admin, categoryId, productName, `CAT-${stamp}`);

    const token = await stockSession(world.s1.id);
    await expect
      .poll(async () => JSON.stringify((await stockItemRaw(token, productName)) ?? ""), { timeout: 30_000 })
      .toContain(categoryName);
  });
});
