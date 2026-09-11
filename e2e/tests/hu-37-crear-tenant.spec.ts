import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import { apiBaseUrl, authHeaders, loginPlatformAdminApi } from "../fixtures/api";
import { loginAsPlatformAdmin } from "../fixtures/auth";

// HU-37 · Crear tenant
// requirements/multi-tenant/HU-37-crear-tenant.md
//
// Mirrors application-e2e.properties' app.femme.jwt.secret exactly — used only to forge a
// tenant-scoped token for a tenant that has no real user yet (HU-41 creates tenant admins; that's
// out of this story's scope), so AC-5/AC-7 can be checked against the real business-data endpoints.
// Same technique as hu-34-rol-platform-admin.spec.ts's forgeHs256Jwt.
const E2E_JWT_SECRET = "e2e-jwt-secret-min-32-characters-long!!";

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function forgeHs256Jwt(payload: Record<string, unknown>): string {
  const header = { alg: "HS256", typ: "JWT" };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = createHmac("sha256", E2E_JWT_SECRET).update(signingInput).digest();
  return `${signingInput}.${base64url(signature)}`;
}

test.describe("HU-37 · Crear tenant", () => {
  // AC-1 (form fields) + AC-4 (created Activo) + AC-6 (confirmation + appears immediately in the
  // listing).
  test("AC1+AC4+AC6: Platform Admin creates a tenant with name/domain/tier and sees it appear, Active, in the listing", async ({
    page,
  }) => {
    await loginAsPlatformAdmin(page);
    await page.getByRole("link", { name: "Tenants" }).click();
    await expect(page).toHaveURL(/\/platform\/tenants/);
    await expect(page.getByRole("heading", { name: "Tenants" })).toBeVisible();

    await page.getByRole("button", { name: "New tenant" }).click();
    const dlg = page.getByRole("dialog", { name: "New tenant" });
    await expect(dlg.getByLabel("Name")).toBeVisible();
    await expect(dlg.getByLabel("Domain (optional)")).toBeVisible();
    await expect(dlg.getByLabel("Initial tier")).toBeVisible();

    const tenantName = `E2E Salon ${Date.now()}`;
    const domain = `e2e-${Date.now()}.pelu.app`;
    await dlg.getByLabel("Name").fill(tenantName);
    await dlg.getByLabel("Domain (optional)").fill(domain);
    // At least the default seeded tier is always present (see FemmeDataInitializer / V41).
    await dlg.getByLabel("Initial tier").selectOption({ index: 1 });
    await dlg.getByRole("button", { name: "Create tenant" }).click();

    await expect(dlg).toBeHidden();
    await expect(
      page.getByRole("alert").filter({ hasText: "Tenant created successfully." }),
    ).toBeVisible();

    const row = page.locator("tr").filter({ hasText: tenantName }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row).toContainText(domain);
    await expect(row.getByText("Active", { exact: true })).toBeVisible();
  });

  // AC-2: an empty name is rejected with a clear, field-level error message; the form stays open.
  test("AC2: an empty tenant name is rejected with a clear error", async ({ page }) => {
    await loginAsPlatformAdmin(page);
    await page.goto("/platform/tenants");
    await page.getByRole("button", { name: "New tenant" }).click();
    const dlg = page.getByRole("dialog", { name: "New tenant" });

    await dlg.getByLabel("Initial tier").selectOption({ index: 1 });
    await dlg.getByRole("button", { name: "Create tenant" }).click();

    await expect(dlg.locator("#tenant-name-err")).toBeVisible();
    await expect(dlg.locator("#tenant-name-err")).toHaveText("Enter a name for the tenant.");
    // Rejected client-side: the dialog never closes.
    await expect(dlg).toBeVisible();
  });

  // AC-3: a domain already used by another tenant is rejected with a clear error; an empty
  // domain is explicitly allowed (Notas para pruebas: "dominio vacío permitido").
  test("AC3: a duplicate domain is rejected, but an empty domain is allowed", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const sharedDomain = `e2e-dup-${Date.now()}.pelu.app`;
    const tiersRes = await request.get(`${apiBaseUrl()}/api/platform/tenants/tiers`, {
      headers: authHeaders(platformToken),
    });
    expect(tiersRes.ok(), await tiersRes.text()).toBeTruthy();
    const tiers = (await tiersRes.json()) as Array<{ id: number; name: string }>;
    expect(tiers.length).toBeGreaterThan(0);

    const firstTenantRes = await request.post(`${apiBaseUrl()}/api/platform/tenants`, {
      headers: authHeaders(platformToken),
      data: { name: `E2E Dup Base ${Date.now()}`, domain: sharedDomain, tierId: tiers[0].id },
    });
    expect(firstTenantRes.ok(), await firstTenantRes.text()).toBeTruthy();

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/tenants");
    await page.getByRole("button", { name: "New tenant" }).click();
    const dlg = page.getByRole("dialog", { name: "New tenant" });
    await dlg.getByLabel("Name").fill(`E2E Dup Second ${Date.now()}`);
    await dlg.getByLabel("Domain (optional)").fill(sharedDomain);
    await dlg.getByLabel("Initial tier").selectOption({ index: 1 });
    await dlg.getByRole("button", { name: "Create tenant" }).click();

    await expect(dlg.locator("#tenant-domain-err")).toBeVisible();
    await expect(dlg.locator("#tenant-domain-err")).toHaveText(
      "That domain is already used by another tenant.",
    );
    await expect(dlg).toBeVisible();

    // Empty domain is permitted: clear the domain field and submit again — succeeds.
    await dlg.getByLabel("Domain (optional)").fill("");
    await dlg.getByRole("button", { name: "Create tenant" }).click();
    await expect(dlg).toBeHidden();
    await expect(
      page.getByRole("alert").filter({ hasText: "Tenant created successfully." }),
    ).toBeVisible();
  });

  // AC-5 (no business data is created for a new tenant) + AC-7 (the new tenant has no visibility
  // into any other tenant's data): a freshly-created tenant's business-data endpoints (clients,
  // professionals, services) all come back empty — proving both that HU-37 didn't spawn any
  // business records itself, and that nothing from the pre-existing demo tenant leaks through.
  test("AC5+AC7: a freshly-created tenant starts with zero business data and no cross-tenant visibility", async ({
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tiersRes = await request.get(`${apiBaseUrl()}/api/platform/tenants/tiers`, {
      headers: authHeaders(platformToken),
    });
    const tiers = (await tiersRes.json()) as Array<{ id: number; name: string }>;

    const createRes = await request.post(`${apiBaseUrl()}/api/platform/tenants`, {
      headers: authHeaders(platformToken),
      data: {
        name: `E2E Isolation ${Date.now()}`,
        domain: null,
        tierId: tiers[0].id,
      },
    });
    expect(createRes.ok(), await createRes.text()).toBeTruthy();
    const created = (await createRes.json()) as { id: number; status: string };
    expect(created.status).toBe("ACTIVE");

    const now = Math.floor(Date.now() / 1000);
    const forged = forgeHs256Jwt({
      sub: "999998",
      email: "e2e-fresh-tenant-admin@e2e.test",
      role: "ADMIN",
      tid: created.id,
      iat: now,
      exp: now + 3600,
    });

    for (const path of ["/api/clients", "/api/professionals", "/api/services"]) {
      const res = await request.get(`${apiBaseUrl()}${path}`, {
        headers: authHeaders(forged),
      });
      expect(res.ok(), `${path} -> ${res.status()}: ${await res.text()}`).toBeTruthy();
      const body = (await res.json()) as unknown[];
      expect(body, `${path} should be empty for a freshly-created tenant`).toEqual([]);
    }
  });
});
