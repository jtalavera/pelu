import { expect, test, type APIRequestContext } from "@playwright/test";
import { apiBaseUrl, authHeaders, loginPlatformAdminApi } from "../fixtures/api";
import { loginAsPlatformAdmin, PLATFORM_ADMIN_EMAIL } from "../fixtures/auth";

// HU-48 · Asignar / cambiar el Tier de un tenant
// requirements/multi-tenant/HU-48-asignar-tier-a-tenant.md
//
// This story formalizes behavior that was already built as part of HU-37 (initial tier at
// creation), HU-38 (tier selector + audit on the edit form) and HU-47 (3-level flag resolution
// actually consulting the tenant's tier). Each test below maps to one HU-48 AC and is written to
// avoid duplicating what hu-37/hu-38/hu-47's own specs already assert byte-for-byte — see the
// comment on each test for exactly what gap it closes.

const SIFEN_FLAG = "SIFEN_ELECTRONIC_INVOICING"; // seeded disabled=false globally (V29)

async function createTierViaApi(request: APIRequestContext, platformToken: string, name: string) {
  const res = await request.post(`${apiBaseUrl()}/api/platform/tiers`, {
    headers: authHeaders(platformToken),
    data: { name, description: null },
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

async function createTenantViaApi(
  request: APIRequestContext,
  platformToken: string,
  overrides: { name: string; domain?: string | null; tierId: number },
) {
  const res = await request.post(`${apiBaseUrl()}/api/platform/tenants`, {
    headers: authHeaders(platformToken),
    data: {
      name: overrides.name,
      domain: overrides.domain ?? null,
      tierId: overrides.tierId,
    },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as { id: number; name: string; tierId: number; tierName: string };
}

async function getTenantFlagsView(
  request: APIRequestContext,
  platformToken: string,
  tenantId: number,
) {
  const res = await request.get(`${apiBaseUrl()}/api/admin/feature-flags/tenants/${tenantId}`, {
    headers: authHeaders(platformToken),
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as Array<{
    flagKey: string;
    hasTier: boolean;
    tierEnabled: boolean | null;
    hasOverride: boolean;
    effectiveEnabled: boolean;
    effectiveSource: "GLOBAL" | "TIER" | "OVERRIDE";
  }>;
}

test.describe("HU-48 · Asignar tier a tenant", () => {
  // AC-1: the tenant edit form (HU-38) shows a selector listing every existing tier, including one
  // created moments earlier — proves the list isn't a hardcoded/stale snapshot.
  test("AC1: the tenant edit form's tier selector lists every existing tier", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tiersBefore = await request.get(`${apiBaseUrl()}/api/platform/tenants/tiers`, {
      headers: authHeaders(platformToken),
    });
    const existingTiers = (await tiersBefore.json()) as Array<{ id: number; name: string }>;
    const seedTier = existingTiers[0];

    const freshTierName = `E2E HU48 Fresh Tier ${Date.now()}`;
    const freshTier = await createTierViaApi(request, platformToken, freshTierName);

    const tenant = await createTenantViaApi(request, platformToken, {
      name: `E2E HU48 Selector ${Date.now()}`,
      domain: null,
      tierId: seedTier.id,
    });

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/tenants");
    await page.getByTestId(`platform-tenant-row-${tenant.id}`).click();
    const dlg = page.getByRole("dialog", { name: "Edit tenant" });
    await expect(dlg).toBeVisible();

    const select = dlg.getByLabel("Tier");
    const optionLabels = await select.locator("option").allTextContents();
    for (const t of existingTiers) {
      expect(optionLabels).toContain(t.name);
    }
    expect(optionLabels).toContain(freshTierName);
    expect(freshTier.id).not.toBe(seedTier.id);
  });

  // AC-2: a tenant always has a tier assigned — the create and edit forms both reject submitting
  // with no tier selected, client-side, with a clear field error, and neither creates the tenant
  // nor clears its existing tier. Not covered by hu-37/hu-38's specs (they only ever submit a
  // tier), so this is genuinely new coverage.
  test("AC2: tier is mandatory on both create and edit — submitting with no tier is rejected", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tiersRes = await request.get(`${apiBaseUrl()}/api/platform/tenants/tiers`, {
      headers: authHeaders(platformToken),
    });
    const tiers = (await tiersRes.json()) as Array<{ id: number; name: string }>;
    const seedTier = tiers[0];

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/tenants");

    // Create form: leaving the tier at its blank placeholder is rejected.
    await page.getByRole("button", { name: "New tenant" }).click();
    const createDlg = page.getByRole("dialog", { name: "New tenant" });
    await createDlg.getByLabel("Name").fill(`E2E HU48 NoTier ${Date.now()}`);
    await createDlg.getByRole("button", { name: "Create tenant" }).click();
    await expect(createDlg.locator("#tenant-tier-err")).toHaveText("Select an initial tier.");
    await expect(createDlg).toBeVisible();
    await createDlg.getByRole("button", { name: "Cancel" }).click();

    // Edit form: a tenant that already has a tier cannot have it cleared back to "no tier".
    const tenant = await createTenantViaApi(request, platformToken, {
      name: `E2E HU48 EditNoTier ${Date.now()}`,
      domain: null,
      tierId: seedTier.id,
    });
    await page.goto("/platform/tenants");
    await page.getByTestId(`platform-tenant-row-${tenant.id}`).click();
    const editDlg = page.getByRole("dialog", { name: "Edit tenant" });
    await expect(editDlg).toBeVisible();
    await editDlg.getByLabel("Tier").selectOption({ value: "" });
    await editDlg.getByRole("button", { name: "Save changes" }).click();
    await expect(editDlg.locator("#tenant-edit-tier-err")).toHaveText("Select an initial tier.");
    await expect(editDlg).toBeVisible();

    // Confirm the backend never persisted a "no tier" state either.
    const stillRes = await request.get(`${apiBaseUrl()}/api/platform/tenants?page=0&size=200`, {
      headers: authHeaders(platformToken),
    });
    const stillTenants = (await stillRes.json()) as {
      content: Array<{ id: number; tierId: number | null }>;
    };
    const stillTenant = stillTenants.content.find((t) => t.id === tenant.id)!;
    expect(stillTenant.tierId).toBe(seedTier.id);
  });

  // AC-3: reassigning a tenant's tier updates the effective (tier-sourced) feature-flag resolution
  // immediately — no restart, no caching layer. This is the genuine gap: hu-38's AC3+AC4 test only
  // proves a pre-existing *override* survives a tier change; hu-47's spec only changes a tier's own
  // flag definitions, never reassigns which tier a tenant belongs to. Here the tenant itself moves
  // from a tier with no opinion on the flag (falls through to the global default, false) to a tier
  // that explicitly includes it (true) — with no tenant-level override involved at any point.
  test("AC3: changing a tenant's tier immediately changes its tier-sourced effective flag value", async ({
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tierA = await createTierViaApi(request, platformToken, `E2E HU48 TierA ${Date.now()}`);
    const tierB = await createTierViaApi(request, platformToken, `E2E HU48 TierB ${Date.now()}`);
    await setTierFlagIncluded(request, platformToken, tierB.id, SIFEN_FLAG, true);

    const tenant = await createTenantViaApi(request, platformToken, {
      name: `E2E HU48 Reassign ${Date.now()}`,
      domain: null,
      tierId: tierA.id,
    });

    // Tier A has no opinion on the flag -> falls through to the global default (false).
    let rows = await getTenantFlagsView(request, platformToken, tenant.id);
    let sifen = rows.find((r) => r.flagKey === SIFEN_FLAG);
    expect(sifen?.hasTier).toBe(false);
    expect(sifen?.effectiveSource).toBe("GLOBAL");
    expect(sifen?.effectiveEnabled).toBe(false);

    // Reassign the tenant from tier A to tier B — no tenant-level flag write at all.
    const updateRes = await request.put(`${apiBaseUrl()}/api/platform/tenants/${tenant.id}`, {
      headers: authHeaders(platformToken),
      data: { name: tenant.name, domain: null, tierId: tierB.id },
    });
    expect(updateRes.ok(), await updateRes.text()).toBeTruthy();

    // Immediately (same test, no wait/restart) the resolved value comes from tier B's default.
    rows = await getTenantFlagsView(request, platformToken, tenant.id);
    sifen = rows.find((r) => r.flagKey === SIFEN_FLAG);
    expect(sifen?.hasTier).toBe(true);
    expect(sifen?.tierEnabled).toBe(true);
    expect(sifen?.hasOverride).toBe(false);
    expect(sifen?.effectiveSource).toBe("TIER");
    expect(sifen?.effectiveEnabled).toBe(true);
  });

  // AC-4: a tier change is audited — when, by whom, and from which tier to which tier — and
  // surfaced back on the tenant. Covered end-to-end (UI) by hu-38's AC6 test; this asserts the same
  // fact directly against the API response shape (previousTierName/newTierName/changedByEmail on
  // TenantResponse.lastTierChange), which is what any other consumer of this data actually reads.
  test("AC4: a tier change is audited with who/when/previous-tier/new-tier", async ({
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tierA = await createTierViaApi(request, platformToken, `E2E HU48 AuditA ${Date.now()}`);
    const tierB = await createTierViaApi(request, platformToken, `E2E HU48 AuditB ${Date.now()}`);

    const tenant = await createTenantViaApi(request, platformToken, {
      name: `E2E HU48 Audit ${Date.now()}`,
      domain: null,
      tierId: tierA.id,
    });

    const beforeChange = new Date();
    const updateRes = await request.put(`${apiBaseUrl()}/api/platform/tenants/${tenant.id}`, {
      headers: authHeaders(platformToken),
      data: { name: tenant.name, domain: null, tierId: tierB.id },
    });
    expect(updateRes.ok(), await updateRes.text()).toBeTruthy();
    const updated = (await updateRes.json()) as {
      lastTierChange: {
        changedAt: string;
        changedByEmail: string;
        previousTierName: string;
        newTierName: string;
      } | null;
    };

    expect(updated.lastTierChange).not.toBeNull();
    expect(updated.lastTierChange!.previousTierName).toBe(tierA.name);
    expect(updated.lastTierChange!.newTierName).toBe(tierB.name);
    expect(updated.lastTierChange!.changedByEmail).toBe(PLATFORM_ADMIN_EMAIL);
    const changedAt = new Date(updated.lastTierChange!.changedAt);
    expect(changedAt.getTime()).toBeGreaterThanOrEqual(beforeChange.getTime() - 5_000);
    expect(changedAt.getTime()).toBeLessThanOrEqual(Date.now() + 5_000);
  });
});
