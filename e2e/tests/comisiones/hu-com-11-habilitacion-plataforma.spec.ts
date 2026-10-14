import { expect, test } from "@playwright/test";
import { API_BASE, apiGetJson, loginPlatformAdminApi } from "../../fixtures/api";
import { loginAsPlatformAdmin } from "../../fixtures/auth";
import {
  applyChanges,
  enableCommissionsGlobally,
  entriesOfInvoice,
  issueInvoice,
  loginAdminUi,
  provisionCommissionWorld,
  restoreCommissionsGlobal,
  setGlobalFlag,
  setTenantFlag,
} from "../../fixtures/commissions";

/** HU-COM-11 · Habilitar el módulo de comisiones desde la plataforma. */

test.afterAll(async ({ request }) => {
  await restoreCommissionsGlobal(request);
});

test("la flag COMMISSIONS existe apagada globalmente: ningún tenant ve el módulo", async ({ page, request }) => {
  await setGlobalFlag(request, "COMMISSIONS", false);
  const w = await provisionCommissionWorld(request, "HU-COM-11 off");
  const platform = await loginPlatformAdminApi(request);
  const flags = await apiGetJson<{ flagKey: string; enabled: boolean }[]>(request, platform, "/api/admin/feature-flags");
  expect(flags.find((f) => f.flagKey === "COMMISSIONS")?.enabled).toBe(false);
  // Even with a tenant override ON, global AND tier AND tenant → off.
  await loginAdminUi(page, w);
  await expect(page.getByRole("link", { name: "Commissions" })).toHaveCount(0);
  const res = await request.get(`${API_BASE}/api/commissions/settings`, {
    headers: { Authorization: `Bearer ${w.adminToken}` },
  });
  expect(res.status()).toBe(403);
  // No entries are generated while off.
  const inv = await issueInvoice(request, w.adminToken, [
    { serviceId: w.service.id, name: w.service.name, professionalId: w.ana.id },
  ]);
  await setGlobalFlag(request, "COMMISSIONS", true);
  await new Promise((r) => setTimeout(r, 1000));
  const entries = await apiGetJson<{ invoiceId: number }[]>(request, w.adminToken, "/api/commissions/entries");
  expect(entries.filter((e) => e.invoiceId === inv.id)).toHaveLength(0);
});

test("se habilita por tier y por tenant con la resolución global Y tier Y tenant; la plataforma la muestra traducida", async ({
  page,
  request,
}) => {
  await enableCommissionsGlobally(request);
  const w = await provisionCommissionWorld(request, "HU-COM-11 on");
  // Tenant override OFF wins over global ON.
  await setTenantFlag(request, w.tenantId, "COMMISSIONS", false);
  const platform = await loginPlatformAdminApi(request);
  let rows = await apiGetJson<{ flagKey: string; effectiveEnabled: boolean }[]>(
    request,
    platform,
    `/api/admin/feature-flags/tenants/${w.tenantId}`,
  );
  expect(rows.find((r) => r.flagKey === "COMMISSIONS")?.effectiveEnabled).toBe(false);
  await setTenantFlag(request, w.tenantId, "COMMISSIONS", true);
  rows = await apiGetJson(request, platform, `/api/admin/feature-flags/tenants/${w.tenantId}`);
  expect(rows.find((r) => r.flagKey === "COMMISSIONS")?.effectiveEnabled).toBe(true);

  await loginAsPlatformAdmin(page);
  await page.goto("/platform/global-feature-flags");
  await expect(page.getByTestId("global-flag-row-COMMISSIONS")).toContainText("Commissions module");
});

test("al habilitar arranca con la configuración por defecto; al deshabilitar y reactivar se conservan los datos", async ({
  request,
}) => {
  await enableCommissionsGlobally(request);
  const w = await provisionCommissionWorld(request, "HU-COM-11 data");
  const settings = await apiGetJson<{
    base: string;
    defaultPercentService: number;
    defaultPercentProduct: number;
    periodicity: string;
  }>(request, w.adminToken, "/api/commissions/settings");
  expect(settings.base).toBe("NET_OF_TAX");
  expect(Number(settings.defaultPercentService)).toBe(0);
  expect(Number(settings.defaultPercentProduct)).toBe(0);
  expect(settings.periodicity).toBe("MONTHLY");

  await applyChanges(request, w.adminToken, [{ scope: "RULE", serviceId: w.service.id, value: "40" }]);
  const inv = await issueInvoice(request, w.adminToken, [
    { serviceId: w.service.id, name: w.service.name, professionalId: w.ana.id },
  ]);
  await entriesOfInvoice(request, w.adminToken, inv.id, 1);
  await setTenantFlag(request, w.tenantId, "COMMISSIONS", false);
  await setTenantFlag(request, w.tenantId, "COMMISSIONS", true);
  const rules = await apiGetJson<{ generalPercent: number }>(request, w.adminToken, `/api/commissions/items/${w.service.id}/rules`);
  expect(Number(rules.generalPercent)).toBe(40);
  expect(await entriesOfInvoice(request, w.adminToken, inv.id, 1)).toHaveLength(1);
});

test("sólo PLATFORM_ADMIN cambia la flag: un ADMIN de tenant no puede", async ({ request }) => {
  await enableCommissionsGlobally(request);
  const w = await provisionCommissionWorld(request, "HU-COM-11 admin");
  const res = await request.put(`${API_BASE}/api/admin/feature-flags/tenants/${w.tenantId}/COMMISSIONS`, {
    headers: { Authorization: `Bearer ${w.adminToken}`, "Content-Type": "application/json" },
    data: { enabled: false },
  });
  expect([401, 403]).toContain(res.status());
});
