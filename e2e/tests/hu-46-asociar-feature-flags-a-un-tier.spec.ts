import { expect, test } from "@playwright/test";
import { apiBaseUrl, authHeaders, loginPlatformAdminApi } from "../fixtures/api";
import { loginAsPlatformAdmin, PLATFORM_ADMIN_EMAIL } from "../fixtures/auth";

// HU-46 · Asociar feature flags a un Tier (revisión 2026-09-09: el tier ACTIVA o DESACTIVA cada flag)
// requirements/multi-tenant/HU-46-asociar-feature-flags-a-un-tier.md
//
// GUIDED_TOUR (global ON, V8) es el flag objetivo: cada tier lo hereda en ON por defecto (sin fila),
// así que el caso interesante es apagarlo para el tier. El efecto inmediato sobre los tenants del
// tier (AC-4) lo cubre e2e/tests/hu-47-resolucion-de-flags-en-tres-niveles.spec.ts.

test.describe("HU-46 · Asociar feature flags a un Tier", () => {
  // AC-1: from a tier's detail the Platform Admin sees every flag with its global value, this tier's
  // value and the effective value, and can turn the tier's value off.
  test("AC1: Platform Admin sees the flag matrix and turns a flag off for the tier", async ({
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
    // Every tier inherits the global value (ON) by default.
    await expect(toggle).toBeChecked();

    // The Switch's real <input> is visually sr-only and clipped to a 1x1px box, so a
    // coordinate-based click (even forced) can land on the surrounding pill instead of the input
    // itself and silently no-op. Dispatching "click" directly on the element sidesteps that.
    await toggle.dispatchEvent("click");
    await expect(toggle).not.toBeChecked();

    // Backend is the source of truth: the tier now turns GUIDED_TOUR off.
    const flagsRes = await request.get(
      `${apiBaseUrl()}/api/platform/tiers/${tier.id}/feature-flags`,
      { headers: authHeaders(platformToken) },
    );
    expect(flagsRes.ok(), await flagsRes.text()).toBeTruthy();
    const flags = (await flagsRes.json()) as Array<{
      flagKey: string;
      tierEnabled: boolean;
      effectiveEnabled: boolean;
    }>;
    const guidedTour = flags.find((f) => f.flagKey === "GUIDED_TOUR");
    expect(guidedTour?.tierEnabled).toBe(false);
    expect(guidedTour?.effectiveEnabled).toBe(false);
  });

  // AC-2: the tier<->flag value persists across a page reload.
  test("AC2: a tier's flag value persists after reloading the page", async ({ page, request }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tierName = `E2E Persist ${Date.now()}`;
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
    const toggle = flagRow.getByRole("switch");
    await toggle.dispatchEvent("click");
    await expect(toggle).not.toBeChecked();

    await page.reload();
    await page.goto("/platform/tiers");
    const rowAfterReload = page.locator("tr").filter({ hasText: tierName }).first();
    await expect(rowAfterReload).toBeVisible({ timeout: 10_000 });
    await rowAfterReload.click();

    const editDlgAfterReload = page.getByRole("dialog", { name: "Edit tier" });
    const flagRowAfterReload = editDlgAfterReload.getByTestId("tier-flag-row-GUIDED_TOUR");
    await expect(flagRowAfterReload).toBeVisible();
    await expect(flagRowAfterReload.getByRole("switch")).not.toBeChecked();
  });

  // AC-3: changing a tier's flag values never touches the tenant-level values tenants in that tier
  // already have.
  test("AC3: changing a tier's flags does not modify an existing tenant value", async ({
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

    // The tenant has its own explicit value for GUIDED_TOUR, disabling it.
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
    await expect(flagRow.getByRole("switch")).not.toBeChecked();

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

  // AC-4 (efecto inmediato): a tenant on the tier with no value of its own reflects the tier's OFF
  // right away, with no tenant-level write.
  test("AC4: turning a flag off for a tier restricts the tier's tenants immediately", async ({
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const createTierRes = await request.post(`${apiBaseUrl()}/api/platform/tiers`, {
      headers: authHeaders(platformToken),
      data: { name: `E2E Immediate ${Date.now()}`, description: null },
    });
    expect(createTierRes.ok(), await createTierRes.text()).toBeTruthy();
    const tier = (await createTierRes.json()) as { id: number };

    const createTenantRes = await request.post(`${apiBaseUrl()}/api/platform/tenants`, {
      headers: authHeaders(platformToken),
      data: { name: `E2E Immediate Tenant ${Date.now()}`, domain: null, tierId: tier.id },
    });
    expect(createTenantRes.ok(), await createTenantRes.text()).toBeTruthy();
    const tenant = (await createTenantRes.json()) as { id: number };

    const putRes = await request.put(
      `${apiBaseUrl()}/api/platform/tiers/${tier.id}/feature-flags/GUIDED_TOUR`,
      { headers: authHeaders(platformToken), data: { enabled: false } },
    );
    expect(putRes.ok(), await putRes.text()).toBeTruthy();

    const viewRes = await request.get(
      `${apiBaseUrl()}/api/admin/feature-flags/tenants/${tenant.id}`,
      { headers: authHeaders(platformToken) },
    );
    const view = (await viewRes.json()) as Array<{
      flagKey: string;
      hasOverride: boolean;
      effectiveEnabled: boolean;
    }>;
    const guidedTour = view.find((f) => f.flagKey === "GUIDED_TOUR");
    expect(guidedTour?.hasOverride).toBe(false);
    expect(guidedTour?.effectiveEnabled).toBe(false);
  });

  // AC-5: changing a tier's flag value is audited — who, when, previous and new value.
  test("AC5: changing a tier's flag value records who changed it and when", async ({
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
    await expect(flagRow.getByRole("switch")).not.toBeChecked();

    const history = editDlg.getByTestId("tier-flag-history-GUIDED_TOUR");
    await expect(history).toBeVisible();
    await expect(history).toContainText(PLATFORM_ADMIN_EMAIL);
    await expect(history).toContainText("Activated");
    await expect(history).toContainText("Deactivated");
  });
});
