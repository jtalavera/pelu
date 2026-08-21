import { expect, test } from "@playwright/test";
import { apiBaseUrl, authHeaders, loginPlatformAdminApi } from "../fixtures/api";
import { loginAsPlatformAdmin, PLATFORM_ADMIN_EMAIL } from "../fixtures/auth";

// HU-46 · Asociar feature flags a un Tier
// requirements/multi-tenant/HU-46-asociar-feature-flags-a-un-tier.md
//
// GUIDED_TOUR is used as the target flag throughout: it's seeded by V8__feature_flags.sql, so it
// always exists regardless of environment/seed order (there's no UI/API to create new global
// flags — only HU-49's existing global-flag catalog can be associated to a tier).
//
// AC-4 ("Efecto inmediato para tenants sin override") is covered by HU-47's own spec
// (e2e/tests/hu-47-resolucion-de-flags-en-tres-niveles.spec.ts, "AC1: a tenant with a tier and no
// override resolves to the tier's default the instant the tier includes the flag"), not here: that
// story is the one that taught the 3-level flag resolution (global -> tier -> tenant override) to
// actually consult the tier<->flag association this story defines/persists.

test.describe("HU-46 · Asociar feature flags a un Tier", () => {
  // AC-1: from a tier's detail, the Platform Admin sees every existing feature flag and can mark
  // which ones are included in that tier's default package.
  test("AC1: Platform Admin sees the flag matrix in a tier's detail and marks a flag as included", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tierName = `E2E Flags ${Date.now()}`;
    const createTierRes = await request.post(`${apiBaseUrl()}/api/platform/tiers`, {
      headers: authHeaders(platformToken),
      data: { name: tierName, description: null },
    });
    expect(createTierRes.ok(), await createTierRes.text()).toBeTruthy();
    const tier = (await createTierRes.json()) as { id: number; name: string };

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/tiers");

    const row = page.locator("tr").filter({ hasText: tierName }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click();

    const editDlg = page.getByRole("dialog", { name: "Edit tier" });
    await expect(editDlg.getByTestId("tier-flags-list")).toBeVisible();

    const flagRow = editDlg.getByTestId("tier-flag-row-GUIDED_TOUR");
    await expect(flagRow).toBeVisible();
    const toggle = flagRow.getByRole("switch");
    await expect(toggle).not.toBeChecked();

    // The Switch's real <input> is visually sr-only and clipped to a 1x1px box, so a
    // coordinate-based click (even forced) can land on the surrounding pill instead of the input
    // itself and silently no-op. Dispatching "click" directly on the element sidesteps that.
    await toggle.dispatchEvent("click");
    await expect(toggle).toBeChecked();

    // Backend is the source of truth: the tier now includes GUIDED_TOUR in its default package.
    const flagsRes = await request.get(
      `${apiBaseUrl()}/api/platform/tiers/${tier.id}/feature-flags`,
      { headers: authHeaders(platformToken) },
    );
    expect(flagsRes.ok(), await flagsRes.text()).toBeTruthy();
    const flags = (await flagsRes.json()) as Array<{ flagKey: string; included: boolean }>;
    expect(flags.find((f) => f.flagKey === "GUIDED_TOUR")?.included).toBe(true);
  });

  // AC-2: the tier<->flag association persists across a page reload.
  test("AC2: including a flag in a tier persists after reloading the page", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tierName = `E2E Persist ${Date.now()}`;
    const createTierRes = await request.post(`${apiBaseUrl()}/api/platform/tiers`, {
      headers: authHeaders(platformToken),
      data: { name: tierName, description: null },
    });
    expect(createTierRes.ok(), await createTierRes.text()).toBeTruthy();
    const tier = (await createTierRes.json()) as { id: number; name: string };

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/tiers");

    const row = page.locator("tr").filter({ hasText: tierName }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click();

    const editDlg = page.getByRole("dialog", { name: "Edit tier" });
    const flagRow = editDlg.getByTestId("tier-flag-row-GUIDED_TOUR");
    await expect(flagRow).toBeVisible();
    const toggle = flagRow.getByRole("switch");
    await toggle.dispatchEvent("click");
    await expect(toggle).toBeChecked();

    await page.reload();
    await page.goto("/platform/tiers");
    const rowAfterReload = page.locator("tr").filter({ hasText: tierName }).first();
    await expect(rowAfterReload).toBeVisible({ timeout: 10_000 });
    await rowAfterReload.click();

    const editDlgAfterReload = page.getByRole("dialog", { name: "Edit tier" });
    const flagRowAfterReload = editDlgAfterReload.getByTestId("tier-flag-row-GUIDED_TOUR");
    await expect(flagRowAfterReload).toBeVisible();
    await expect(flagRowAfterReload.getByRole("switch")).toBeChecked();
  });

  // AC-3: changing which flags a tier includes never touches the tenant-level overrides tenants
  // in that tier already have.
  test("AC3: changing a tier's flags does not modify an existing tenant override", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);

    const tierName = `E2E NoOverrideImpact ${Date.now()}`;
    const createTierRes = await request.post(`${apiBaseUrl()}/api/platform/tiers`, {
      headers: authHeaders(platformToken),
      data: { name: tierName, description: null },
    });
    expect(createTierRes.ok(), await createTierRes.text()).toBeTruthy();
    const tier = (await createTierRes.json()) as { id: number; name: string };

    const createTenantRes = await request.post(`${apiBaseUrl()}/api/platform/tenants`, {
      headers: authHeaders(platformToken),
      data: { name: `E2E Tier Flags Tenant ${Date.now()}`, domain: null, tierId: tier.id },
    });
    expect(createTenantRes.ok(), await createTenantRes.text()).toBeTruthy();
    const tenant = (await createTenantRes.json()) as { id: number };

    // The tenant has its own explicit override for GUIDED_TOUR, disabling it.
    const overrideRes = await request.put(
      `${apiBaseUrl()}/api/admin/feature-flags/tenants/${tenant.id}/GUIDED_TOUR`,
      { headers: authHeaders(platformToken), data: { enabled: false } },
    );
    expect(overrideRes.ok(), await overrideRes.text()).toBeTruthy();

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/tiers");
    const row = page.locator("tr").filter({ hasText: tierName }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click();

    const editDlg = page.getByRole("dialog", { name: "Edit tier" });
    const flagRow = editDlg.getByTestId("tier-flag-row-GUIDED_TOUR");
    await expect(flagRow).toBeVisible();
    await flagRow.getByRole("switch").dispatchEvent("click");
    await expect(flagRow.getByRole("switch")).toBeChecked();

    const tenantFlagsRes = await request.get(
      `${apiBaseUrl()}/api/admin/feature-flags/tenants/${tenant.id}`,
      { headers: authHeaders(platformToken) },
    );
    expect(tenantFlagsRes.ok(), await tenantFlagsRes.text()).toBeTruthy();
    const tenantFlags = (await tenantFlagsRes.json()) as Array<{
      flagKey: string;
      hasOverride: boolean;
      overrideEnabled: boolean | null;
    }>;
    const guidedTour = tenantFlags.find((f) => f.flagKey === "GUIDED_TOUR");
    expect(guidedTour?.hasOverride).toBe(true);
    expect(guidedTour?.overrideEnabled).toBe(false);
  });

  // AC-5: changing whether a tier includes a flag is audited — who, when, previous and new value.
  test("AC5: including a flag in a tier records who changed it and when", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tierName = `E2E Audit ${Date.now()}`;
    const createTierRes = await request.post(`${apiBaseUrl()}/api/platform/tiers`, {
      headers: authHeaders(platformToken),
      data: { name: tierName, description: null },
    });
    expect(createTierRes.ok(), await createTierRes.text()).toBeTruthy();

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/tiers");
    const row = page.locator("tr").filter({ hasText: tierName }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click();

    const editDlg = page.getByRole("dialog", { name: "Edit tier" });
    const flagRow = editDlg.getByTestId("tier-flag-row-GUIDED_TOUR");
    await expect(flagRow).toBeVisible();
    await flagRow.getByRole("switch").dispatchEvent("click");
    await expect(flagRow.getByRole("switch")).toBeChecked();

    const history = editDlg.getByTestId("tier-flag-history-GUIDED_TOUR");
    await expect(history).toBeVisible();
    await expect(history).toContainText(PLATFORM_ADMIN_EMAIL);
    await expect(history).toContainText("Not included");
    await expect(history).toContainText("Included");
  });
});
