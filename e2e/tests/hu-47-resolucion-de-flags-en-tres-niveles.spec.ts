import { expect, test, type APIRequestContext } from "@playwright/test";
import { apiBaseUrl, authHeaders, loginAsDemoApi, loginPlatformAdminApi } from "../fixtures/api";
import { loginAsPlatformAdmin } from "../fixtures/auth";

// HU-47 · Resolución de flags en 3 niveles: global -> tier del tenant -> override del tenant
// requirements/multi-tenant/HU-47-resolucion-de-flags-en-tres-niveles.md
//
// SIFEN_ELECTRONIC_INVOICING (seeded disabled=false globally, V29) is used for every scenario that
// needs to tell "tier default" apart from "global default" without touching any shared global
// value: a tier can only ever mark a flag as *included* (which always resolves to enabled=true,
// see TierAdminService#setTierFeatureFlagIncluded) — there is no admin path to make a tier force a
// flag off — so starting from a global default of false makes the tier's "true" unmistakable.
// GUIDED_TOUR (globally enabled=true, V8) is used for the "no tier" scenario against the seeded
// DEMO tenant (id=1, predates HU-37's tier requirement) — read-only, so it's safe to share with
// whatever else runs concurrently against that tenant.

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
  effectiveSource: "GLOBAL" | "TIER" | "OVERRIDE";
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

async function setTierFlagIncluded(
  request: APIRequestContext,
  platformToken: string,
  tierId: number,
  flagKey: string,
  included: boolean,
) {
  const res = await request.put(
    `${apiBaseUrl()}/api/platform/tiers/${tierId}/feature-flags/${flagKey}`,
    { headers: authHeaders(platformToken), data: { included } },
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

test.describe("HU-47 · Resolución de flags en 3 niveles", () => {
  // AC-1 + HU-46 AC-4 follow-up: a tenant with a tier and no override resolves to the tier's
  // value the moment the tier is made to include the flag — no tenant-level write needed. This is
  // exactly the "efecto inmediato" HU-46 flagged as blocked on this story.
  test("AC1: a tenant with a tier and no override resolves to the tier's default the instant the tier includes the flag", async ({
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

    // Before the tier defines the flag: falls through to the global default (false).
    let rows = await getTenantFlagsView(request, platformToken, tenant.id);
    let sifen = rows.find((r) => r.flagKey === SIFEN_FLAG);
    expect(sifen?.globalEnabled).toBe(false);
    expect(sifen?.hasTier).toBe(false);
    expect(sifen?.effectiveSource).toBe("GLOBAL");
    expect(sifen?.effectiveEnabled).toBe(false);

    // The Platform Admin includes the flag in the tier's default package — immediate effect, no
    // write against the tenant itself.
    await setTierFlagIncluded(request, platformToken, tier.id, SIFEN_FLAG, true);

    rows = await getTenantFlagsView(request, platformToken, tenant.id);
    sifen = rows.find((r) => r.flagKey === SIFEN_FLAG);
    expect(sifen?.hasTier).toBe(true);
    expect(sifen?.tierEnabled).toBe(true);
    expect(sifen?.hasOverride).toBe(false);
    expect(sifen?.effectiveSource).toBe("TIER");
    expect(sifen?.effectiveEnabled).toBe(true);
  });

  // AC-1: an explicit tenant override always wins, even when the tenant's tier also defines the
  // flag — the override doesn't need to be removed/redone when the tier package changes.
  test("AC1: a tenant override wins over the tier's default", async ({ request }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tier = await createTierViaApi(request, platformToken, `E2E HU47 Tier ${Date.now()}`);
    await setTierFlagIncluded(request, platformToken, tier.id, SIFEN_FLAG, true);
    const tenant = await createTenantViaApi(
      request,
      platformToken,
      `E2E HU47 Tenant ${Date.now()}`,
      tier.id,
    );

    // No override yet: tier's "true" is the effective value.
    let rows = await getTenantFlagsView(request, platformToken, tenant.id);
    let sifen = rows.find((r) => r.flagKey === SIFEN_FLAG);
    expect(sifen?.effectiveSource).toBe("TIER");
    expect(sifen?.effectiveEnabled).toBe(true);

    // The Platform Admin forces this one tenant off, despite its tier including the flag.
    const overrideRes = await request.put(
      `${apiBaseUrl()}/api/admin/feature-flags/tenants/${tenant.id}/${SIFEN_FLAG}`,
      { headers: authHeaders(platformToken), data: { enabled: false } },
    );
    expect(overrideRes.ok(), await overrideRes.text()).toBeTruthy();

    rows = await getTenantFlagsView(request, platformToken, tenant.id);
    sifen = rows.find((r) => r.flagKey === SIFEN_FLAG);
    expect(sifen?.hasOverride).toBe(true);
    expect(sifen?.overrideEnabled).toBe(false);
    expect(sifen?.effectiveSource).toBe("OVERRIDE");
    expect(sifen?.effectiveEnabled).toBe(false);
    // The tier's own value is still surfaced for visibility even though it isn't the effective one.
    expect(sifen?.hasTier).toBe(true);
    expect(sifen?.tierEnabled).toBe(true);
  });

  // AC-2 + AC-5: a tenant without a tier assigned (the seeded DEMO tenant #1 predates HU-37's tier
  // requirement) resolves exactly as it did before this story: global default unless overridden.
  // Read-only against the shared DEMO tenant, so safe to run alongside anything else.
  test("AC2+AC5: a tenant without a tier resolves using only the global default and any override, unaffected by tiers", async ({
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const rows = await getTenantFlagsView(request, platformToken, 1);
    const guidedTour = rows.find((r) => r.flagKey === GUIDED_TOUR_FLAG);
    expect(guidedTour?.hasTier).toBe(false);
    expect(guidedTour?.tierEnabled).toBeNull();
    if (!guidedTour?.hasOverride) {
      expect(guidedTour?.effectiveSource).toBe("GLOBAL");
      expect(guidedTour?.effectiveEnabled).toBe(guidedTour?.globalEnabled);
    } else {
      expect(guidedTour?.effectiveSource).toBe("OVERRIDE");
      expect(guidedTour?.effectiveEnabled).toBe(guidedTour?.overrideEnabled);
    }
  });

  // AC-3: GET /api/feature-flags (the endpoint a real tenant session's app actually calls) still
  // has the same contract — a flat { flags: { KEY: boolean } } map — and resolves the same value
  // the admin view computes for that tenant/flag; only the internal calculation gained the tier
  // level.
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

  // AC-4: the Platform Admin's tenant feature-flags screen shows explicitly which of the 3 levels
  // produced the currently-effective value.
  test("AC4: the tenant feature-flags screen shows the effective source (global/tier/override)", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tier = await createTierViaApi(request, platformToken, `E2E HU47 UI Tier ${Date.now()}`);
    await setTierFlagIncluded(request, platformToken, tier.id, SIFEN_FLAG, true);
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
    const sourceBlock = page.getByTestId(`feature-flag-source-${SIFEN_FLAG}`);
    await expect(sourceBlock).toBeVisible();
    await expect(page.getByTestId(`feature-flag-source-badge-${SIFEN_FLAG}`)).toContainText(
      "From tier default",
    );

    // Force a tenant override off; the badge switches to reflect the new effective source.
    const overrideRes = await request.put(
      `${apiBaseUrl()}/api/admin/feature-flags/tenants/${tenant.id}/${SIFEN_FLAG}`,
      { headers: authHeaders(platformToken), data: { enabled: false } },
    );
    expect(overrideRes.ok(), await overrideRes.text()).toBeTruthy();

    await page.reload();
    await page.getByLabel("Organization").fill(tenant.name);
    await page.getByRole("button", { name: new RegExp(tenant.name) }).click();
    await expect(page.getByTestId(`feature-flag-source-badge-${SIFEN_FLAG}`)).toContainText(
      "From organization override",
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

  // The Tier Default column's "Edit in {tier} →" link is how a Platform Admin is meant to discover
  // where tier-level flags actually get edited (a separate screen) — it should land exactly on that
  // tier's edit modal, not just the tiers list.
  test("the tier-default link jumps straight to that tier's edit modal in Platform → Tiers", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tier = await createTierViaApi(
      request,
      platformToken,
      `E2E HU47 DeepLink Tier ${Date.now()}`,
    );
    await setTierFlagIncluded(request, platformToken, tier.id, SIFEN_FLAG, true);
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

    // The redesigned page repeats the identical "Edit in {tier} →" deep-link on every flag row
    // (one per seeded flag) whenever the selected tenant has a tier — they all point at the same
    // tier edit modal, so any one of them exercises this AC.
    await page.getByRole("link", { name: new RegExp(`Edit in ${tier.name}`) }).first().click();

    await expect(page).toHaveURL(/\/platform\/tiers/);
    await expect(page.getByRole("dialog", { name: "Edit tier" })).toBeVisible();
    await expect(page.locator("#tier-edit-name")).toHaveValue(tier.name);
  });
});
