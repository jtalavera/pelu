import { expect, test, type APIRequestContext } from "@playwright/test";
import { apiBaseUrl, authHeaders, loginPlatformAdminApi } from "../fixtures/api";
import { loginAsPlatformAdmin, PLATFORM_ADMIN_EMAIL } from "../fixtures/auth";

// HU-38 · Editar datos de un tenant
// requirements/multi-tenant/HU-38-editar-tenant.md
//
// Depends on HU-37 (crear tenant) for /platform/tenants and on the two tiers seeded for e2e by
// FemmeDataInitializer ("Estándar", "Premium") — HU-45 (full tier CRUD) hasn't landed yet, so this
// story can only exercise an actual tier *change* because a second tier already exists.

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
  return (await res.json()) as {
    id: number;
    name: string;
    domain: string | null;
    tierId: number;
    tierName: string;
    status: string;
  };
}

test.describe("HU-38 · Editar tenant", () => {
  // AC-1: the Platform Admin opens an existing tenant and edits its name/domain/tier; the change
  // shows up in the listing right away.
  test("AC1: Platform Admin edits name, domain, and tier of an existing tenant", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tiersRes = await request.get(`${apiBaseUrl()}/api/platform/tenants/tiers`, {
      headers: authHeaders(platformToken),
    });
    const tiers = (await tiersRes.json()) as Array<{ id: number; name: string }>;
    expect(tiers.length).toBeGreaterThanOrEqual(2);
    const estandar = tiers.find((t) => t.name === "Estándar")!;
    const premium = tiers.find((t) => t.name === "Premium")!;
    expect(estandar).toBeTruthy();
    expect(premium).toBeTruthy();

    const original = await createTenantViaApi(request, platformToken, {
      name: `E2E Editable ${Date.now()}`,
      domain: `e2e-edit-${Date.now()}.pelu.app`,
      tierId: estandar.id,
    });

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/tenants");
    const row = page.getByTestId(`platform-tenant-row-${original.id}`);
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click();

    const dlg = page.getByRole("dialog", { name: "Edit tenant" });
    await expect(dlg).toBeVisible();
    await expect(dlg.getByLabel("Name")).toHaveValue(original.name);
    await expect(dlg.getByLabel("Domain (optional)")).toHaveValue(original.domain ?? "");

    const newName = `${original.name} (edited)`;
    const newDomain = `e2e-edited-${Date.now()}.pelu.app`;
    await dlg.getByLabel("Name").fill(newName);
    await dlg.getByLabel("Domain (optional)").fill(newDomain);
    await dlg.getByLabel("Tier").selectOption({ label: "Premium" });
    await dlg.getByRole("button", { name: "Save changes" }).click();

    await expect(dlg).toBeHidden();
    await expect(
      page.getByRole("alert").filter({ hasText: "Tenant updated successfully." }),
    ).toBeVisible();

    const updatedRow = page.getByTestId(`platform-tenant-row-${original.id}`);
    await expect(updatedRow).toContainText(newName);
    await expect(updatedRow).toContainText(newDomain);
    await expect(updatedRow).toContainText("Premium");
  });

  // AC-2: same validations as create — empty name rejected, domain uniqueness excludes the tenant
  // being edited itself (keeping its own domain must not be rejected), and a duplicate of another
  // tenant's domain is rejected.
  test("AC2: empty name is rejected; duplicate domain (of another tenant) is rejected, own domain is allowed", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tiersRes = await request.get(`${apiBaseUrl()}/api/platform/tenants/tiers`, {
      headers: authHeaders(platformToken),
    });
    const tiers = (await tiersRes.json()) as Array<{ id: number; name: string }>;
    const estandar = tiers.find((t) => t.name === "Estándar")!;

    const stamp = Date.now();
    const other = await createTenantViaApi(request, platformToken, {
      name: `E2E Other ${stamp}`,
      domain: `e2e-other-${stamp}.pelu.app`,
      tierId: estandar.id,
    });
    const subject = await createTenantViaApi(request, platformToken, {
      name: `E2E Subject ${stamp}`,
      domain: `e2e-subject-${stamp}.pelu.app`,
      tierId: estandar.id,
    });

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/tenants");
    await page.getByTestId(`platform-tenant-row-${subject.id}`).click();
    const dlg = page.getByRole("dialog", { name: "Edit tenant" });
    await expect(dlg).toBeVisible();

    // Empty name.
    await dlg.getByLabel("Name").fill("   ");
    await dlg.getByRole("button", { name: "Save changes" }).click();
    await expect(dlg.locator("#tenant-edit-name-err")).toHaveText(
      "Enter a name for the tenant.",
    );
    await expect(dlg).toBeVisible();

    // Duplicate domain of another tenant.
    await dlg.getByLabel("Name").fill(subject.name);
    await dlg.getByLabel("Domain (optional)").fill(other.domain!);
    await dlg.getByRole("button", { name: "Save changes" }).click();
    await expect(dlg.locator("#tenant-edit-domain-err")).toHaveText(
      "That domain is already used by another tenant.",
    );
    await expect(dlg).toBeVisible();

    // Keeping its own domain is allowed (excluded from the uniqueness check).
    await dlg.getByLabel("Domain (optional)").fill(subject.domain!);
    await dlg.getByRole("button", { name: "Save changes" }).click();
    await expect(dlg).toBeHidden();
    await expect(
      page.getByRole("alert").filter({ hasText: "Tenant updated successfully." }),
    ).toBeVisible();
  });

  // AC-3/AC-4: changing a tenant's tier persists immediately (no server restart / caching layer
  // involved) and does not clear any pre-existing per-tenant feature-flag override.
  test("AC3+AC4: tier change is reflected immediately and doesn't clear existing flag overrides", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tiersRes = await request.get(`${apiBaseUrl()}/api/platform/tenants/tiers`, {
      headers: authHeaders(platformToken),
    });
    const tiers = (await tiersRes.json()) as Array<{ id: number; name: string }>;
    const estandar = tiers.find((t) => t.name === "Estándar")!;
    const premium = tiers.find((t) => t.name === "Premium")!;

    const tenant = await createTenantViaApi(request, platformToken, {
      name: `E2E Overrides ${Date.now()}`,
      domain: null,
      tierId: estandar.id,
    });

    // Set a per-tenant flag override before touching the tier.
    const globalsRes = await request.get(`${apiBaseUrl()}/api/admin/feature-flags`, {
      headers: authHeaders(platformToken),
    });
    const globals = (await globalsRes.json()) as Array<{ flagKey: string; enabled: boolean }>;
    expect(globals.length).toBeGreaterThan(0);
    const flagKey = globals[0].flagKey;
    const overrideValue = !globals[0].enabled;
    const overrideRes = await request.put(
      `${apiBaseUrl()}/api/admin/feature-flags/tenants/${tenant.id}/${flagKey}`,
      { headers: authHeaders(platformToken), data: { enabled: overrideValue } },
    );
    expect(overrideRes.ok(), await overrideRes.text()).toBeTruthy();

    // Change the tier via the API (equivalent to the UI form) — no restart, no delay expected.
    const updateRes = await request.put(`${apiBaseUrl()}/api/platform/tenants/${tenant.id}`, {
      headers: authHeaders(platformToken),
      data: { name: tenant.name, domain: null, tierId: premium.id },
    });
    expect(updateRes.ok(), await updateRes.text()).toBeTruthy();
    const updated = (await updateRes.json()) as { tierId: number; tierName: string };
    expect(updated.tierId).toBe(premium.id);
    expect(updated.tierName).toBe("Premium");

    // AC-4: the override survives the tier change, immediately (same request cycle, no caching).
    const viewRes = await request.get(
      `${apiBaseUrl()}/api/admin/feature-flags/tenants/${tenant.id}`,
      { headers: authHeaders(platformToken) },
    );
    expect(viewRes.ok(), await viewRes.text()).toBeTruthy();
    const rows = (await viewRes.json()) as Array<{
      flagKey: string;
      hasOverride: boolean;
      overrideEnabled: boolean | null;
    }>;
    const row = rows.find((r) => r.flagKey === flagKey)!;
    expect(row.hasOverride).toBe(true);
    expect(row.overrideEnabled).toBe(overrideValue);

    // Also visible from the platform tenants listing (UI), confirming AC-3's "no restart needed".
    await loginAsPlatformAdmin(page);
    await page.goto("/platform/tenants");
    const row2 = page.getByTestId(`platform-tenant-row-${tenant.id}`);
    await expect(row2).toBeVisible({ timeout: 10_000 });
    await expect(row2).toContainText("Premium");
  });

  // AC-5: edits persist across a full page reload (not just client-side state).
  test("AC5: edited tenant data persists after reloading the page", async ({ page, request }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tiersRes = await request.get(`${apiBaseUrl()}/api/platform/tenants/tiers`, {
      headers: authHeaders(platformToken),
    });
    const tiers = (await tiersRes.json()) as Array<{ id: number; name: string }>;
    const estandar = tiers.find((t) => t.name === "Estándar")!;
    const premium = tiers.find((t) => t.name === "Premium")!;

    const tenant = await createTenantViaApi(request, platformToken, {
      name: `E2E Persist ${Date.now()}`,
      domain: null,
      tierId: estandar.id,
    });

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/tenants");
    await page.getByTestId(`platform-tenant-row-${tenant.id}`).click();
    const dlg = page.getByRole("dialog", { name: "Edit tenant" });
    const renamedTo = `${tenant.name} renamed`;
    await dlg.getByLabel("Name").fill(renamedTo);
    await dlg.getByLabel("Tier").selectOption({ label: "Premium" });
    await dlg.getByRole("button", { name: "Save changes" }).click();
    await expect(dlg).toBeHidden();

    await page.reload();
    const row = page.getByTestId(`platform-tenant-row-${tenant.id}`);
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row).toContainText(renamedTo);
    await expect(row).toContainText("Premium");
    expect(premium.id).not.toBe(estandar.id);
  });

  // AC-6: a tier change is audited — who changed it and when — and surfaced back in the edit form.
  test("AC6: tier change is audited with who/when and shown on the edit form", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tiersRes = await request.get(`${apiBaseUrl()}/api/platform/tenants/tiers`, {
      headers: authHeaders(platformToken),
    });
    const tiers = (await tiersRes.json()) as Array<{ id: number; name: string }>;
    const estandar = tiers.find((t) => t.name === "Estándar")!;

    const tenant = await createTenantViaApi(request, platformToken, {
      name: `E2E Audit ${Date.now()}`,
      domain: null,
      tierId: estandar.id,
    });

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/tenants");
    await page.getByTestId(`platform-tenant-row-${tenant.id}`).click();
    let dlg = page.getByRole("dialog", { name: "Edit tenant" });
    // No prior tier change yet.
    await expect(page.getByTestId("tenant-edit-last-tier-change")).toHaveCount(0);
    await dlg.getByLabel("Tier").selectOption({ label: "Premium" });
    await dlg.getByRole("button", { name: "Save changes" }).click();
    await expect(dlg).toBeHidden();

    await page.getByTestId(`platform-tenant-row-${tenant.id}`).click();
    dlg = page.getByRole("dialog", { name: "Edit tenant" });
    const history = page.getByTestId("tenant-edit-last-tier-change");
    await expect(history).toBeVisible();
    await expect(history).toContainText("Estándar");
    await expect(history).toContainText("Premium");
    await expect(history).toContainText(PLATFORM_ADMIN_EMAIL);
  });
});
