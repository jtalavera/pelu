import { expect, test } from "@playwright/test";

import { loginAsPlatformAdmin } from "../../fixtures/auth";
import {
  createCategory,
  createProduct,
  pelu,
  peluLogin,
  peluOk,
  platformToken,
  setTenantFlag,
  stock,
  stockFlags,
  stockItemByName,
  stockSession,
  waitForStockSession,
} from "../../fixtures/stock/api";
import { INTEGRATION_CLIENT_ID, INTEGRATION_CLIENT_SECRET } from "../../fixtures/stock/env";
import { getStockWorld } from "../../fixtures/stock/world";

// HU-61 · Activar Stock para un salón (Cambio 4).

async function newTenant(token: string, name: string, tierId: number) {
  const tenant = await peluOk<{ id: number }>("/api/platform/tenants", {
    token,
    body: { name, domain: null, tierId },
  });
  const email = `stock-act-${tenant.id}-${Date.now()}@e2e.local`;
  const invite = await peluOk<{ rawToken: string }>(`/api/platform/tenants/${tenant.id}/admins`, {
    token,
    body: { email },
  });
  await peluOk("/api/auth/activate", {
    body: { token: invite.rawToken, password: "StockE2e1!", confirmPassword: "StockE2e1!", fullName: "Admin" },
  });
  return { id: tenant.id, adminToken: await peluLogin(email, "StockE2e1!") };
}

test.describe("HU-61 · Activar Stock para un salón", () => {
  test("cambiar el tier del salón a uno con Stock lo da de alta en Stock con sus depósitos y productos", async ({
    page,
  }) => {
    const world = getStockWorld();
    const token = await platformToken();
    const name = `Activación por tier ${Date.now()}`;
    const t = await newTenant(token, name, world.noStockTierId);
    const cat = await createCategory(t.adminToken, "Productos");
    const product = `Shampoo activación ${Date.now()}`;
    await createProduct(t.adminToken, cat, product, "SH-ACT");
    // Without Stock nothing reaches control-stock.
    await expect(stockSession(t.id)).rejects.toThrow();

    // The Platform Admin moves the salon to the Stock tier from the tenant dialog.
    await loginAsPlatformAdmin(page);
    await page.goto("/platform/tenants");
    await page.locator("#platform-tenants-search").fill(name);
    await page.locator("#platform-tenants-search").press("Enter");
    await page.getByTestId(`platform-tenant-row-${t.id}`).click();
    await page.locator("#tenant-edit-tier").selectOption({ value: String(world.stockTierId) });
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.locator("#tenant-edit-tier")).toBeHidden();

    // "En segundos el salón existe en Stock…"
    const stockToken = await waitForStockSession(t.id, 30_000);
    const locations = (await stock<{ code: string; name: string }[]>("/api/v1/locations", { token: stockToken })).body;
    expect(locations.map((l) => l.name)).toEqual(expect.arrayContaining(["Vitrina (venta)", "Uso interno"]));
    // "…y con todos sus productos cargados."
    await expect.poll(async () => (await stockItemByName(stockToken, product))?.sku, { timeout: 30_000 }).toBe("SH-ACT");
    const me = (await stock<{ tenant?: { name: string }; user?: { tenantName: string } }>("/api/v1/me", { token: stockToken })).body;
    expect(JSON.stringify(me)).toContain(name);
  });

  test("prender STOCK_MODULE en la pantalla de flags del salón activa Stock; apagarlo se refleja en Stock", async ({
    page,
  }) => {
    const world = getStockWorld();
    const token = await platformToken();
    const name = `Activación por flag ${Date.now()}`;
    const t = await newTenant(token, name, world.stockTierId);
    // Created inside a Stock tier with the global ON → already provisioned; turn it OFF first.
    await setTenantFlag(token, t.id, "STOCK_MODULE", false);
    await expect.poll(async () => {
      try {
        await stockSession(t.id);
        return "on";
      } catch {
        return "off";
      }
    }, { timeout: 30_000 }).toBe("off");

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/feature-flags");
    await page.getByLabel("Organization").fill(name);
    await page.getByRole("button", { name }).click();
    const sw = page.locator("#ff-tenant-STOCK_MODULE");
    await expect(sw).not.toBeChecked();
    await sw.dispatchEvent("click");
    await expect(sw).toBeChecked();

    await waitForStockSession(t.id, 30_000);
  });

  test("cualquier cambio de un flag STOCK_* llega solo a Stock, con una versión que solo sube", async () => {
    const world = getStockWorld();
    const token = await platformToken();
    const stockToken = await stockSession(world.s2.id);
    const before = await stockFlags(stockToken);
    expect(before.flags.STOCK_TOURS).not.toBe(false);

    await setTenantFlag(token, world.s2.id, "STOCK_TOURS", false);
    await expect.poll(async () => (await stockFlags(stockToken)).flags.STOCK_TOURS, { timeout: 30_000 }).toBe(false);
    const after = await stockFlags(stockToken);
    expect(Number(after.version)).toBeGreaterThan(Number(before.version ?? 0));

    await peluOk(`/api/admin/feature-flags/tenants/${world.s2.id}/STOCK_TOURS`, { method: "DELETE", token });
    await expect.poll(async () => (await stockFlags(stockToken)).flags.STOCK_TOURS, { timeout: 30_000 }).toBe(true);
  });

  test("si cambia el nombre del salón, Stock se entera (TENANT_UPSERT)", async () => {
    const world = getStockWorld();
    const token = await platformToken();
    const tenants = (await peluOk<{ content: Array<{ id: number; name: string; domain: string | null; tierId: number }> }>(
      `/api/platform/tenants?size=100&q=${encodeURIComponent("Stock Salón Dos")}`,
      { token },
    )).content;
    const s2 = tenants.find((x) => x.id === world.s2.id)!;
    const renamed = `${s2.name} (renombrado)`;
    await peluOk(`/api/platform/tenants/${s2.id}`, {
      method: "PUT",
      token,
      body: { name: renamed, domain: s2.domain, tierId: s2.tierId },
    });
    try {
      await expect
        .poll(async () => JSON.stringify((await stock("/api/v1/me", { token: await stockSession(s2.id) })).body), {
          timeout: 30_000,
        })
        .toContain("renombrado");
    } finally {
      await peluOk(`/api/platform/tenants/${s2.id}`, {
        method: "PUT",
        token,
        body: { name: s2.name, domain: s2.domain, tierId: s2.tierId },
      });
    }
  });

  test("Stock consulta los flags con su usuario técnico (pull): token M2M + /feature-flags/resolved", async () => {
    const world = getStockWorld();
    const tokenRes = await fetch(`${process.env.PLAYWRIGHT_API_BASE_URL}/api/integration/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: INTEGRATION_CLIENT_ID,
        client_secret: INTEGRATION_CLIENT_SECRET,
        scope: "flags:read",
      }),
    });
    expect(tokenRes.status).toBe(200);
    const m2m = ((await tokenRes.json()) as { access_token: string }).access_token;
    const r = await pelu<Record<string, { version: number; flags: Record<string, boolean> }>>(
      `/api/integration/feature-flags/resolved?prefix=STOCK_&tenantIds=${world.s1.id},${world.s3.id}`,
      { token: m2m },
    );
    expect(r.status).toBe(200);
    expect(r.body[String(world.s1.id)].flags.STOCK_MODULE).toBe(true);
    expect(r.body[String(world.s1.id)].version).toBeGreaterThanOrEqual(1);
    expect(r.body[String(world.s3.id)].flags.STOCK_MODULE).toBe(false);
    expect(Object.keys(r.body[String(world.s1.id)].flags).every((k) => k.startsWith("STOCK_"))).toBe(true);

    // A salon user's session is not an integration token, and a wrong secret is INVALID_CLIENT.
    const userToken = await peluLogin(world.s1.adminEmail, world.s1.adminPassword);
    expect((await pelu(`/api/integration/feature-flags/resolved?tenantIds=${world.s1.id}`, { token: userToken })).status).toBe(401);
    const bad = await fetch(`${process.env.PLAYWRIGHT_API_BASE_URL}/api/integration/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: INTEGRATION_CLIENT_ID, client_secret: "nope" }),
    });
    expect(bad.status).toBe(401);
    expect(await bad.text()).toContain("INVALID_CLIENT");
  });
});
