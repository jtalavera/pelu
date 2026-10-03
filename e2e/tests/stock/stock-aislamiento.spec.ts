import { expect, test } from "@playwright/test";

import {
  createProduct,
  outbox,
  pelu,
  peluLogin,
  platformToken,
  stockItemByName,
  stockSession,
} from "../../fixtures/stock/api";
import { getStockWorld } from "../../fixtures/stock/world";

// Aislamiento entre salones con un control-stock real (criterio de verificación del plan).

test.describe("Aislamiento entre salones en Stock", () => {
  test("los productos de un salón solo existen en el Stock de ese salón", async () => {
    const world = getStockWorld();
    const s1 = await peluLogin(world.s1.adminEmail, world.s1.adminPassword);
    const name = `Aislado S1 ${Date.now()}`;
    await createProduct(s1, world.s1.categoryId, name);
    const stock1 = await stockSession(world.s1.id);
    const stock2 = await stockSession(world.s2.id);
    await expect.poll(async () => !!(await stockItemByName(stock1, name)), { timeout: 30_000 }).toBe(true);
    expect(await stockItemByName(stock2, name)).toBeUndefined();
    // Its outbox events belong to S1 only.
    const platform = await platformToken();
    const s2Events = await outbox(platform, world.s2.id, "DONE");
    expect(s2Events.every((e) => e.tenantId === world.s2.id)).toBe(true);
  });

  test("availability y SSO quedan atados al salón del usuario", async () => {
    const world = getStockWorld();
    const s1 = await peluLogin(world.s1.adminEmail, world.s1.adminPassword);
    const s2 = await peluLogin(world.s2.adminEmail, world.s2.adminPassword);
    const otherId = await createProduct(s1, world.s1.categoryId, `Ajeno ${Date.now()}`);
    const avail = await pelu<{ items: unknown[] }>(`/api/stock/availability?serviceIds=${otherId}`, { token: s2 });
    expect(avail.status).toBe(200);
    expect(avail.body.items).toHaveLength(0);

    const sso = await pelu<{ token: string }>("/api/sso/stock", { method: "POST", token: s2 });
    const claims = JSON.parse(Buffer.from(sso.body.token.split(".")[1], "base64url").toString());
    expect(claims.tid).toBe(String(world.s2.id));
  });
});
