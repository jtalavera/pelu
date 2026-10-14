import { expect, test } from "@playwright/test";

import {
  API_BASE,
  authHeaders,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginPlatformAdminApi,
} from "../../fixtures/api";
import { getMtWorld, mtLoginToken, type MtTenant } from "../../fixtures/mt/world";

/**
 * Módulo de comisiones — aislamiento multi-tenant (requirements/prds/femme_modulo_comisiones_v1.md
 * §10 "Aislamiento"). COMMISSIONS starts OFF globally (HU-COM-11), so this spec turns it on for the
 * duration of the file and restores it (and removes its tenant overrides) afterwards — the suite
 * runs with a single worker, so no other spec observes the temporary value.
 */
const FLAG = "COMMISSIONS";

async function platform(request: Parameters<typeof loginPlatformAdminApi>[0]) {
  return loginPlatformAdminApi(request);
}

test.describe("mt-comisiones · aislamiento del módulo de comisiones", () => {
  test.beforeAll(async ({ request }) => {
    const world = getMtWorld();
    const token = await platform(request);
    const put = (path: string, enabled: boolean) =>
      request.put(`${API_BASE}${path}`, { headers: authHeaders(token), data: { enabled } });
    expect((await put(`/api/admin/feature-flags/${FLAG}`, true)).ok()).toBeTruthy();
    for (const t of [world.tenantA, world.tenantB]) {
      expect((await put(`/api/admin/feature-flags/tenants/${t.id}/${FLAG}`, true)).ok()).toBeTruthy();
    }
  });

  test.afterAll(async ({ request }) => {
    const world = getMtWorld();
    const token = await platform(request);
    await request.put(`${API_BASE}/api/admin/feature-flags/${FLAG}`, {
      headers: authHeaders(token),
      data: { enabled: false },
    });
    for (const t of [world.tenantA, world.tenantB]) {
      await request.delete(`${API_BASE}/api/admin/feature-flags/tenants/${t.id}/${FLAG}`, {
        headers: authHeaders(token),
      });
    }
  });

  test("la base de cálculo y las reglas son independientes por tenant; no se pueden referenciar ítems ni profesionales ajenos", async ({
    request,
  }) => {
    const world = getMtWorld();
    const tokenA = await mtLoginToken(request, world.tenantA);
    const tokenB = await mtLoginToken(request, world.tenantB);
    const change = (token: string, changes: unknown[]) =>
      request.post(`${API_BASE}/api/commissions/changes`, {
        headers: authHeaders(token),
        data: { changes, applyMode: "IMMEDIATE", replacePending: true, preview: false },
      });

    expect((await change(tokenA, [{ scope: "BASE", value: "TAX_INCLUDED" }])).ok()).toBeTruthy();
    const settingsB = await (await request.get(`${API_BASE}/api/commissions/settings`, { headers: authHeaders(tokenB) })).json();
    expect(settingsB.history.map((h: { value: string }) => h.value)).not.toContain("TAX_INCLUDED");

    const serviceA = world.tenantA.catalog.serviceIds[0];
    expect((await change(tokenA, [{ scope: "RULE", serviceId: serviceA, value: "40" }])).ok()).toBeTruthy();
    const foreignRule = await change(tokenB, [{ scope: "RULE", serviceId: serviceA, value: "50" }]);
    expect(foreignRule.status()).toBe(404);
    expect(await foreignRule.text()).toContain("SERVICE_NOT_FOUND");
    const foreignException = await change(tokenB, [
      {
        scope: "RULE",
        serviceId: world.tenantB.catalog.serviceIds[0],
        professionalId: world.tenantA.professionalIds[0],
        value: "50",
      },
    ]);
    expect(foreignException.status()).toBe(404);
    const rulesOfA = await request.get(`${API_BASE}/api/commissions/items/${serviceA}/rules`, { headers: authHeaders(tokenB) });
    expect(rulesOfA.status()).toBe(404);

    const matrixB = await (await request.get(`${API_BASE}/api/commissions/matrix`, { headers: authHeaders(tokenB) })).json();
    const rowIds = matrixB.rows.map((r: { serviceId: number }) => r.serviceId);
    for (const id of world.tenantA.catalog.serviceIds) expect(rowIds).not.toContain(id);
  });

  test("entradas y liquidaciones de un tenant no son visibles ni accesibles desde otro", async ({ request }) => {
    const world = getMtWorld();
    const issuer: MtTenant | undefined = [world.tenantA, world.tenantB].find((t) => !t.sifenEnabled);
    test.skip(!issuer, "both isolation tenants issue through SIFEN in this world");
    const other = issuer === world.tenantA ? world.tenantB : world.tenantA;
    const tokenI = await mtLoginToken(request, issuer!);
    const tokenO = await mtLoginToken(request, other);
    await ensureCashSessionOpenApi(request, tokenI);
    await ensureActiveFiscalStampForInvoices(request, tokenI);
    const serviceId = issuer!.catalog.serviceIds[0];
    const professionalId = issuer!.professionalIds[0];
    const inv = await request.post(`${API_BASE}/api/invoices`, {
      headers: authHeaders(tokenI),
      data: {
        clientId: null,
        clientDisplayName: "MT comisiones",
        discountType: "NONE",
        lines: [{ serviceId, description: issuer!.catalog.serviceNames[0], quantity: 1, unitPrice: 100000, professionalId }],
        payments: [{ method: "CASH", amount: 100000 }],
      },
    });
    expect(inv.ok(), await inv.text()).toBeTruthy();
    const invoiceId = ((await inv.json()) as { id: number }).id;

    await expect
      .poll(async () => {
        const es = await (await request.get(`${API_BASE}/api/commissions/entries`, { headers: authHeaders(tokenI) })).json();
        return (es as { invoiceId: number }[]).some((e) => e.invoiceId === invoiceId);
      })
      .toBe(true);
    const today = new Date().toISOString().slice(0, 10);
    const gen = await request.post(`${API_BASE}/api/commissions/settlements/generate`, {
      headers: authHeaders(tokenI),
      data: { periodFrom: today, periodTo: today, professionalIds: [professionalId] },
    });
    expect(gen.ok(), await gen.text()).toBeTruthy();
    const [settlement] = (await gen.json()) as { id: number }[];

    const entriesO = (await (await request.get(`${API_BASE}/api/commissions/entries`, { headers: authHeaders(tokenO) })).json()) as {
      invoiceId: number;
    }[];
    expect(entriesO.some((e) => e.invoiceId === invoiceId)).toBe(false);
    const listO = (await (await request.get(`${API_BASE}/api/commissions/settlements`, { headers: authHeaders(tokenO) })).json()) as {
      items: { id: number }[];
    };
    expect(listO.items.map((s) => s.id)).not.toContain(settlement.id);
    for (const path of [
      `/api/commissions/settlements/${settlement.id}`,
      `/api/commissions/settlements/${settlement.id}/pdf`,
    ]) {
      const r = await request.get(`${API_BASE}${path}`, { headers: authHeaders(tokenO) });
      expect(r.status(), path).toBe(404);
    }
    const approve = await request.post(`${API_BASE}/api/commissions/settlements/${settlement.id}/approve`, {
      headers: authHeaders(tokenO),
    });
    expect(approve.status()).toBe(404);
    // An invoice line can't name another tenant's professional.
    const crossLine = await request.post(`${API_BASE}/api/invoices`, {
      headers: authHeaders(tokenI),
      data: {
        clientId: null,
        clientDisplayName: "MT comisiones",
        discountType: "NONE",
        lines: [{ serviceId, description: "x", quantity: 1, unitPrice: 100000, professionalId: other.professionalIds[0] }],
        payments: [{ method: "CASH", amount: 100000 }],
      },
    });
    expect(crossLine.status()).toBe(404);
  });
});
