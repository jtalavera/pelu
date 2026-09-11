import { expect, test, type APIRequestContext } from "@playwright/test";
import { apiBaseUrl, authHeaders, loginAsDemoApi, loginPlatformAdminApi } from "../fixtures/api";
import { loginAsPlatformAdmin } from "../fixtures/auth";

// HU-47 · Resolución de flags en 3 niveles — CONJUNCIÓN (AND): efectivo = global AND tier AND tenant
// requirements/multi-tenant/HU-47-resolucion-de-flags-en-tres-niveles.md (revisión 2026-09-09)
//
// Un flag está activo solo si lo está en los 3 niveles. Una fila ausente en el nivel tier o tenant
// significa "heredar" (ON), así que un nivel solo puede *restringir* (apagar). SIFEN_ELECTRONIC_INVOICING
// (default global ON desde V53) y GUIDED_TOUR (default global ON, V8) sirven como flags cuyo global
// arranca en ON, de modo que apagarlos en el tier o el tenant es inequívoco.

const SIFEN_FLAG = "SIFEN_ELECTRONIC_INVOICING";
const GUIDED_TOUR_FLAG = "GUIDED_TOUR";

type TenantFlagRow = {
  flagKey: string;
  globalEnabled: boolean;
  hasTier: boolean;
  tierEnabled: boolean | null;
  hasOverride: boolean;
  overrideEnabled: boolean | null;
  effectiveEnabled: boolean;
};

async function createTierViaApi(request: APIRequestContext, platformToken: string, name: string) {
  const res = await request.post(`${apiBaseUrl()}/api/platform/tiers`, {
    headers: authHeaders(platformToken),
    data: { name, description: null },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as { id: number; name: string };
}

async function createTenantViaApi(
  request: APIRequestContext,
  platformToken: string,
  name: string,
  tierId: number,
) {
  const res = await request.post(`${apiBaseUrl()}/api/platform/tenants`, {
    headers: authHeaders(platformToken),
    data: { name, domain: null, tierId },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as { id: number; name: string };
}

async function setTierFlagValue(
  request: APIRequestContext,
  platformToken: string,
  tierId: number,
  flagKey: string,
  enabled: boolean,
) {
  const res = await request.put(
    `${apiBaseUrl()}/api/platform/tiers/${tierId}/feature-flags/${flagKey}`,
    { headers: authHeaders(platformToken), data: { enabled } },
  );
  expect(res.ok(), await res.text()).toBeTruthy();
}

async function setTenantFlagValue(
  request: APIRequestContext,
  platformToken: string,
  tenantId: number,
  flagKey: string,
  enabled: boolean,
) {
  const res = await request.put(
    `${apiBaseUrl()}/api/admin/feature-flags/tenants/${tenantId}/${flagKey}`,
    { headers: authHeaders(platformToken), data: { enabled } },
  );
  expect(res.ok(), await res.text()).toBeTruthy();
}

async function getTenantFlagsView(
  request: APIRequestContext,
  platformToken: string,
  tenantId: number,
): Promise<TenantFlagRow[]> {
  const res = await request.get(`${apiBaseUrl()}/api/admin/feature-flags/tenants/${tenantId}`, {
    headers: authHeaders(platformToken),
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as TenantFlagRow[];
}

test.describe("HU-47 · Resolución de flags en 3 niveles (AND)", () => {
  // AC-1 + HU-46 AC-4: turning a flag OFF at the tier level restricts it for every tenant on that
  // tier that has no restriction of its own — immediately, with no tenant-level write.
  test("AC1: a tier turning a flag off restricts it for the tier's tenants instantly", async ({
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tier = await createTierViaApi(request, platformToken, `E2E HU47 Tier ${Date.now()}`);
    const tenant = await createTenantViaApi(
      request,
      platformToken,
      `E2E HU47 Tenant ${Date.now()}`,
      tier.id,
    );

    // Before: global ON, tier inherits, tenant inherits -> effective ON.
    let rows = await getTenantFlagsView(request, platformToken, tenant.id);
    let sifen = rows.find((r) => r.flagKey === SIFEN_FLAG);
    expect(sifen?.globalEnabled).toBe(true);
    expect(sifen?.hasTier).toBe(false);
    expect(sifen?.effectiveEnabled).toBe(true);

    // The Platform Admin turns the flag OFF for this tier — immediate effect, no tenant write.
    await setTierFlagValue(request, platformToken, tier.id, SIFEN_FLAG, false);

    rows = await getTenantFlagsView(request, platformToken, tenant.id);
    sifen = rows.find((r) => r.flagKey === SIFEN_FLAG);
    expect(sifen?.hasTier).toBe(true);
    expect(sifen?.tierEnabled).toBe(false);
    expect(sifen?.hasOverride).toBe(false);
    expect(sifen?.effectiveEnabled).toBe(false);
  });

  // AC-1: the tenant's own value OFF restricts the flag even when global and tier are ON; and a
  // tenant value of ON can NOT lift a tier that is OFF (conjunctive — the most restrictive wins).
  test("AC1: the tenant value can only restrict, never override a higher level's OFF", async ({
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tier = await createTierViaApi(request, platformToken, `E2E HU47 Tier ${Date.now()}`);
    const tenant = await createTenantViaApi(
      request,
      platformToken,
      `E2E HU47 Tenant ${Date.now()}`,
      tier.id,
    );

    // tenant OFF over global ON + tier inherit -> effective OFF
    await setTenantFlagValue(request, platformToken, tenant.id, SIFEN_FLAG, false);
    let sifen = (await getTenantFlagsView(request, platformToken, tenant.id)).find(
      (r) => r.flagKey === SIFEN_FLAG,
    );
    expect(sifen?.hasOverride).toBe(true);
    expect(sifen?.overrideEnabled).toBe(false);
    expect(sifen?.effectiveEnabled).toBe(false);

    // Now the tier is OFF and the tenant is set back ON -> still OFF (tenant ON can't lift the tier).
    await setTierFlagValue(request, platformToken, tier.id, SIFEN_FLAG, false);
    await setTenantFlagValue(request, platformToken, tenant.id, SIFEN_FLAG, true);
    sifen = (await getTenantFlagsView(request, platformToken, tenant.id)).find(
      (r) => r.flagKey === SIFEN_FLAG,
    );
    expect(sifen?.tierEnabled).toBe(false);
    expect(sifen?.overrideEnabled).toBe(true);
    expect(sifen?.effectiveEnabled).toBe(false);
  });

  // AC-2: when the tenant's tier does not define a flag (no tier row), that level contributes ON —
  // the effective value is just global AND the tenant's own value.
  test("AC2: a tier that does not define a flag contributes ON (inherit)", async ({ request }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tier = await createTierViaApi(request, platformToken, `E2E HU47 Tier ${Date.now()}`);
    const tenant = await createTenantViaApi(
      request,
      platformToken,
      `E2E HU47 Tenant ${Date.now()}`,
      tier.id,
    );

    let guidedTour = (await getTenantFlagsView(request, platformToken, tenant.id)).find(
      (r) => r.flagKey === GUIDED_TOUR_FLAG,
    );
    expect(guidedTour?.hasTier).toBe(false);
    expect(guidedTour?.tierEnabled).toBeNull();
    expect(guidedTour?.effectiveEnabled).toBe(guidedTour?.globalEnabled);

    // The tenant's own OFF is the only restriction -> effective OFF.
    await setTenantFlagValue(request, platformToken, tenant.id, GUIDED_TOUR_FLAG, false);
    guidedTour = (await getTenantFlagsView(request, platformToken, tenant.id)).find(
      (r) => r.flagKey === GUIDED_TOUR_FLAG,
    );
    expect(guidedTour?.hasTier).toBe(false);
    expect(guidedTour?.effectiveEnabled).toBe(false);
  });

  // AC-3: GET /api/feature-flags (the endpoint a real tenant session's app calls) keeps its flat
  // { flags: { KEY: boolean } } contract and resolves the same value the admin view computes.
  test("AC3: GET /api/feature-flags keeps its contract and matches the resolved value", async ({
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const adminRows = await getTenantFlagsView(request, platformToken, 1);
    const guidedTour = adminRows.find((r) => r.flagKey === GUIDED_TOUR_FLAG);

    const demoToken = await loginAsDemoApi(request);
    const res = await request.get(`${apiBaseUrl()}/api/feature-flags`, {
      headers: authHeaders(demoToken),
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const body = (await res.json()) as { flags: Record<string, boolean> };
    expect(body.flags).toHaveProperty(GUIDED_TOUR_FLAG);
    expect(body.flags[GUIDED_TOUR_FLAG]).toBe(guidedTour?.effectiveEnabled);
  });

  // AC-4: the Platform Admin's tenant feature-flags screen shows the effective value and, when it
  // is OFF, which level(s) turned it off.
  test("AC4: the tenant feature-flags screen names the level(s) that disable a flag", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tier = await createTierViaApi(request, platformToken, `E2E HU47 UI Tier ${Date.now()}`);
    await setTierFlagValue(request, platformToken, tier.id, SIFEN_FLAG, false);
    const tenant = await createTenantViaApi(
      request,
      platformToken,
      `E2E HU47 UI Tenant ${Date.now()}`,
      tier.id,
    );

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/feature-flags");
    await page.getByLabel("Organization").fill(tenant.name);
    await page.getByRole("button", { name: new RegExp(tenant.name) }).click();

    await expect(page.getByText(SIFEN_FLAG)).toBeVisible();
    await expect(page.getByTestId(`feature-flag-disabled-by-${SIFEN_FLAG}`)).toContainText(
      "Disabled by: tier",
    );

    // Add a tenant-level OFF too; the note now names both levels.
    await setTenantFlagValue(request, platformToken, tenant.id, SIFEN_FLAG, false);
    await page.reload();
    await page.getByLabel("Organization").fill(tenant.name);
    await page.getByRole("button", { name: new RegExp(tenant.name) }).click();
    await expect(page.getByTestId(`feature-flag-disabled-by-${SIFEN_FLAG}`)).toContainText(
      "organization",
    );
  });

  // The tenant picker replaced a raw numeric-ID form with a live, filtered search — this proves
  // typing narrows results instead of showing every tenant in the system.
  test("the organization search field only shows tenants matching what's typed", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tier = await createTierViaApi(request, platformToken, `E2E HU47 Search Tier ${Date.now()}`);
    const uniqueSuffix = Date.now();
    const tenantA = await createTenantViaApi(
      request,
      platformToken,
      `E2E HU47 SearchAlpha ${uniqueSuffix}`,
      tier.id,
    );
    const tenantB = await createTenantViaApi(
      request,
      platformToken,
      `E2E HU47 SearchBeta ${uniqueSuffix}`,
      tier.id,
    );

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/feature-flags");
    await page.getByLabel("Organization").fill(tenantA.name);

    await expect(page.getByRole("button", { name: new RegExp(tenantA.name) })).toBeVisible();
    await expect(page.getByRole("button", { name: new RegExp(tenantB.name) })).toHaveCount(0);
  });

  // The Tier column's "Edit in {tier} →" link is how a Platform Admin discovers where tier-level
  // flags are edited (a separate screen) — it should land on that tier's edit modal.
  test("the tier link jumps straight to that tier's edit modal in Platform → Tiers", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tier = await createTierViaApi(
      request,
      platformToken,
      `E2E HU47 DeepLink Tier ${Date.now()}`,
    );
    await setTierFlagValue(request, platformToken, tier.id, SIFEN_FLAG, false);
    const tenant = await createTenantViaApi(
      request,
      platformToken,
      `E2E HU47 DeepLink Tenant ${Date.now()}`,
      tier.id,
    );

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/feature-flags");
    await page.getByLabel("Organization").fill(tenant.name);
    await page.getByRole("button", { name: new RegExp(tenant.name) }).click();
    await expect(page.getByText(SIFEN_FLAG)).toBeVisible();

    await page.getByRole("link", { name: new RegExp(`Edit in ${tier.name}`) }).first().click();

    await expect(page).toHaveURL(/\/platform\/tiers/);
    await expect(page.getByRole("dialog", { name: "Edit tier" })).toBeVisible();
    await expect(page.locator("#tier-edit-name")).toHaveValue(tier.name);
  });
});
