import { expect, test } from "@playwright/test";

import { API_BASE, authHeaders } from "../../fixtures/api";
import { getMtWorld, mtLoginToken } from "../../fixtures/mt/world";

/**
 * Stock integration (HU-59..HU-67) — multi-tenant isolation of the pelu-side surface. The mt
 * backend has no control-stock and STOCK_MODULE stays at its global default (OFF): the global flag
 * is shared state and is never written here. The cross-system isolation with a real Stock lives in
 * tests/stock/stock-aislamiento.spec.ts.
 */
test.describe("mt-stock · aislamiento de la integración con Stock", () => {
  test("los productos (tipo PRODUCT) de un salón no aparecen en el catálogo de otro", async ({ request }) => {
    const world = getMtWorld();
    const tokenA = await mtLoginToken(request, world.tenantA);
    const tokenB = await mtLoginToken(request, world.tenantB);
    const name = `MT Producto aislado ${Date.now()}`;
    const created = await request.post(`${API_BASE}/api/services`, {
      headers: authHeaders(tokenA),
      data: {
        name,
        categoryId: world.tenantA.catalog.categoryIds[0],
        priceMinor: 10000,
        durationMinutes: 1,
        kind: "PRODUCT",
        sku: "MT-ISO",
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();

    const pageA = await request.get(`${API_BASE}/api/services/page?kind=PRODUCT&size=200`, { headers: authHeaders(tokenA) });
    const pageB = await request.get(`${API_BASE}/api/services/page?kind=PRODUCT&size=200`, { headers: authHeaders(tokenB) });
    const namesA = ((await pageA.json()) as { content: Array<{ name: string }> }).content.map((s) => s.name);
    const namesB = ((await pageB.json()) as { content: Array<{ name: string }> }).content.map((s) => s.name);
    expect(namesA).toContain(name);
    expect(namesB).not.toContain(name);
  });

  test("availability solo considera servicios del propio salón; SSO sin Stock es 403", async ({ request }) => {
    const world = getMtWorld();
    const tokenB = await mtLoginToken(request, world.tenantB);
    const avail = await request.get(
      `${API_BASE}/api/stock/availability?serviceIds=${world.tenantA.catalog.serviceIds.join(",")}`,
      { headers: authHeaders(tokenB) },
    );
    expect(avail.ok()).toBeTruthy();
    expect(((await avail.json()) as { items: unknown[] }).items).toHaveLength(0);

    const sso = await request.post(`${API_BASE}/api/sso/stock`, { headers: authHeaders(tokenB) });
    expect(sso.status()).toBe(403);
    expect(await sso.text()).toContain("STOCK_MODULE_DISABLED");
  });

  test("un admin de salón no accede al panel de plataforma ni a la superficie M2M", async ({ request }) => {
    const world = getMtWorld();
    const tokenA = await mtLoginToken(request, world.tenantA);
    for (const path of [
      "/api/platform/stock/outbox",
      "/api/platform/stock/summary",
      `/api/platform/tenants/${world.tenantB.id}/stock`,
    ]) {
      const res = await request.get(`${API_BASE}${path}`, { headers: authHeaders(tokenA) });
      expect([401, 403], path).toContain(res.status());
    }
    const sync = await request.post(`${API_BASE}/api/platform/tenants/${world.tenantB.id}/stock/catalog-sync`, {
      headers: authHeaders(tokenA),
    });
    expect([401, 403]).toContain(sync.status());
    const m2m = await request.get(
      `${API_BASE}/api/integration/feature-flags/resolved?tenantIds=${world.tenantA.id},${world.tenantB.id}`,
      { headers: authHeaders(tokenA) },
    );
    expect(m2m.status()).toBe(401);
  });

  test("el pull de flags de Stock resuelve cada salón con su propio tier y valores", async ({ request }) => {
    const world = getMtWorld();
    const tokenRes = await request.post(`${API_BASE}/api/integration/oauth/token`, {
      form: {
        grant_type: "client_credentials",
        client_id: "control-stock",
        client_secret: "e2e-stock-integration-client-secret",
        scope: "flags:read",
      },
    });
    expect(tokenRes.ok(), await tokenRes.text()).toBeTruthy();
    const token = ((await tokenRes.json()) as { access_token: string }).access_token;
    const res = await request.get(
      `${API_BASE}/api/integration/feature-flags/resolved?prefix=STOCK_&tenantIds=${world.tenantA.id},${world.tenantB.id}`,
      { headers: authHeaders(token) },
    );
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as Record<string, { version: number; flags: Record<string, boolean> }>;
    expect(Object.keys(body).sort()).toEqual([String(world.tenantA.id), String(world.tenantB.id)].sort());
    for (const entry of Object.values(body)) {
      expect(Object.keys(entry.flags).every((k) => k.startsWith("STOCK_"))).toBe(true);
      expect(entry.flags.STOCK_MODULE).toBe(false);
    }
  });
});
