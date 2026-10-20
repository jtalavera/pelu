import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import {
  apiBaseUrl,
  apiPostJson,
  authHeaders,
  decodeJwtPayload,
  loginAsDemoApi,
  loginPlatformAdminApi,
} from "../fixtures/api";
import { DEMO_EMAIL, PLATFORM_ADMIN_EMAIL, loginAsPlatformAdmin } from "../fixtures/auth";

// Issue #310 · Impersonar usuarios
// https://github.com/jtalavera/pelu/issues/310
//
// "El admin de la plataforma debe poder impersonar a un tenant admin de cualquier tenant. No es
// necesario que se seleccione un admin específico del tenant, solo con seleccionar el tenant el
// platform admin tiene acceso en un tab nuevo a todos los features de un tenant admin."
//
// Scenarios covered:
//   S1  From the tenant's detail dialog, "Open as administrator" opens the tenant in a NEW tab as
//       its administrator — for a tenant with no admin at all (no admin is picked) — while the
//       Platform Admin's own tab and session stay untouched; the handoff token never stays in
//       the URL.
//   S2  The impersonation tab reaches every tenant-admin feature and the tenant's real data (the
//       seeded DEMO tenant's own client, settings, admin-only navigation).
//   S3  "End impersonation" closes the tab; the Platform Admin's tab keeps working.
//   S4  Suspended tenant: the action is disabled in the UI (with an explanation) and rejected by
//       the API; suspending a tenant also kills an impersonation session already open on it.
//   S5  Access control: only PLATFORM_ADMIN may impersonate; an impersonation token never reaches
//       platform routes; unknown tenant → 404; no cross-tenant access with that token.
//   S6  Traceability: the impersonation start is in the platform audit, and every action taken
//       while impersonating is recorded under the Platform Admin (not a tenant user) in the
//       tenant's own audit trail.
//   S7  Session plumbing: /api/me flags the impersonation, refresh keeps it one, and changing
//       "my" password from inside the tenant is blocked (API 403 + no menu entry).
//   S8  A broken /impersonate link (no token) shows an explanatory error instead of a session.
//
// The suite runs on a single worker (playwright.config.ts), so suspending a disposable tenant
// here can't interleave with another spec.

const DEMO_TENANT_ID = 1;

type Tenant = { id: number; name: string; status: string };
type TokenResponse = { accessToken: string; expiresInSeconds: number; tokenType: string };
type AuditRow = {
  tenantId: number | null;
  userEmail: string | null;
  userRole: string | null;
  httpMethod: string;
  resource: string;
  operation: string | null;
  entityId: string | null;
};
type AuditPage = { content: AuditRow[] };

async function firstTierId(request: APIRequestContext, platformToken: string): Promise<number> {
  const res = await request.get(`${apiBaseUrl()}/api/platform/tenants/tiers`, {
    headers: authHeaders(platformToken),
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const tiers = (await res.json()) as Array<{ id: number }>;
  expect(tiers.length).toBeGreaterThan(0);
  return tiers[0].id;
}

/** A brand-new tenant with no admin user at all — impersonation must not need one. */
async function createTenantApi(
  request: APIRequestContext,
  platformToken: string,
  label: string,
): Promise<Tenant> {
  const tierId = await firstTierId(request, platformToken);
  const res = await request.post(`${apiBaseUrl()}/api/platform/tenants`, {
    headers: authHeaders(platformToken),
    data: { name: `E2E310 ${label} ${Date.now()}`, domain: null, tierId },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as Tenant;
}

async function setTenantStatusApi(
  request: APIRequestContext,
  platformToken: string,
  tenantId: number,
  status: "ACTIVE" | "SUSPENDED",
) {
  const res = await request.patch(`${apiBaseUrl()}/api/platform/tenants/${tenantId}/status`, {
    headers: authHeaders(platformToken),
    data: { status },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

async function impersonateApi(
  request: APIRequestContext,
  platformToken: string,
  tenantId: number,
): Promise<string> {
  const res = await request.post(
    `${apiBaseUrl()}/api/platform/tenants/${tenantId}/impersonation`,
    { headers: authHeaders(platformToken) },
  );
  expect(res.ok(), await res.text()).toBeTruthy();
  return ((await res.json()) as TokenResponse).accessToken;
}

/** Opens the tenant's detail dialog in /platform/tenants (searching by name, the list is paged). */
async function openTenantDialog(page: Page, tenant: { id: number; name: string }) {
  await page.goto("/platform/tenants");
  await page.getByLabel("Search by name or domain").fill(tenant.name);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const row = page.getByTestId(`platform-tenant-row-${tenant.id}`);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();
  const dlg = page.getByRole("dialog", { name: "Edit tenant" });
  await expect(dlg).toBeVisible();
  return dlg;
}

/** Clicks "Open as administrator" and returns the new tab once it has entered the tenant panel. */
async function openAsAdministrator(page: Page, tenant: { id: number; name: string }) {
  const dlg = await openTenantDialog(page, tenant);
  const section = dlg.getByTestId("platform-tenant-impersonation");
  await expect(section).toContainText("Access as administrator");
  const popupPromise = page.context().waitForEvent("page");
  await section.getByRole("button", { name: "Open as administrator" }).click();
  const tab = await popupPromise;
  await expect(tab).toHaveURL(/\/app$/, { timeout: 25_000 });
  await expect(tab.getByTestId("impersonation-banner")).toBeVisible({ timeout: 20_000 });
  return { tab, dlg };
}

test.describe("Issue #310 · Impersonar un tenant admin", () => {
  test("S1: opens a tenant without admins in a new tab as its administrator; the platform tab is untouched", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tenant = await createTenantApi(request, platformToken, "NoAdmins");
    // Precondition: nobody to "pick" — the tenant has no users at all.
    const adminsRes = await request.get(`${apiBaseUrl()}/api/platform/tenants/${tenant.id}/admins`, {
      headers: authHeaders(platformToken),
    });
    expect(adminsRes.ok(), await adminsRes.text()).toBeTruthy();
    expect(await adminsRes.json()).toEqual([]);

    await loginAsPlatformAdmin(page);
    const { tab, dlg } = await openAsAdministrator(page, tenant);

    // The new tab is the tenant's panel, clearly flagged as an impersonation by the root user.
    const banner = tab.getByTestId("impersonation-banner");
    await expect(banner).toContainText("Impersonation mode");
    await expect(banner).toContainText(tenant.name);
    await expect(banner).toContainText(PLATFORM_ADMIN_EMAIL);
    await expect(tab.getByText(tenant.name, { exact: true }).first()).toBeVisible();
    // The handoff token was wiped from the address bar / history.
    expect(tab.url()).not.toContain("token=");
    expect(tab.url()).not.toContain("#");
    const tabToken = await tab.evaluate(() => sessionStorage.getItem("accessToken"));
    expect(tabToken).toBeTruthy();
    const claims = decodeJwtPayload(tabToken!);
    expect(claims.tid).toBe(tenant.id);
    expect(claims.role).toBe("ADMIN");
    expect(claims.imp).toBe(true);

    // The Platform Admin's own tab: same page, same dialog, same (tenant-less) session.
    await expect(page).toHaveURL(/\/platform\/tenants/);
    await expect(dlg).toBeVisible();
    const platformTabToken = await page.evaluate(() => sessionStorage.getItem("accessToken"));
    expect(platformTabToken).toBeTruthy();
    expect(platformTabToken).not.toBe(tabToken);
    const platformClaims = decodeJwtPayload(platformTabToken!);
    expect(platformClaims.role).toBe("PLATFORM_ADMIN");
    expect(platformClaims.tid).toBeUndefined();
    await page.reload();
    await expect(page).toHaveURL(/\/platform\/tenants/);
    await expect(page.getByRole("heading", { name: "Tenants" }).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("S2: the impersonation tab reaches every tenant-admin feature and the tenant's own data", async ({
    page,
    request,
  }) => {
    // Business data that only exists in the DEMO tenant, created by its real administrator.
    const demoToken = await loginAsDemoApi(request);
    const clientName = `E2E310 Demo Client ${Date.now()}`;
    const client = await apiPostJson<{ id: number }>(request, demoToken, "/api/clients", {
      fullName: clientName,
      phone: null,
      email: null,
      ruc: null,
    });

    await loginAsPlatformAdmin(page);
    const platformToken = await loginPlatformAdminApi(request);
    const demoTenant = (await (
      await request.get(`${apiBaseUrl()}/api/platform/tenants?q=&size=100`, {
        headers: authHeaders(platformToken),
      })
    ).json()) as { content: Tenant[] };
    const demo = demoTenant.content.find((t) => t.id === DEMO_TENANT_ID);
    expect(demo, "seeded DEMO tenant").toBeTruthy();

    const { tab } = await openAsAdministrator(page, demo!);

    // Admin-only navigation is there (a professional would not see Professionals / Settings).
    const nav = tab.getByRole("complementary", { name: "Main navigation" });
    for (const item of ["Dashboard", "Calendar", "Clients", "Professionals", "Services", "Billing"]) {
      await expect(nav.getByRole("link", { name: item, exact: true })).toBeVisible();
    }
    await expect(nav.getByRole("link", { name: "Settings", exact: true })).toBeVisible();

    // The tenant's real data, created by its own administrator.
    await tab.goto(`/app/clients/${client.id}`);
    await expect(tab.getByRole("heading", { name: clientName })).toBeVisible({ timeout: 20_000 });
    await expect(tab.getByTestId("impersonation-banner")).toBeVisible();

    // Admin-only settings screen.
    await tab.goto("/app/settings/business");
    await expect(tab).toHaveURL(/\/app\/settings\/business$/);
    await expect(tab.getByTestId("impersonation-banner")).toBeVisible({ timeout: 20_000 });

    // And it can change data like any tenant admin (create a client through the API with the
    // very token the tab is using).
    const tabToken = (await tab.evaluate(() => sessionStorage.getItem("accessToken")))!;
    const created = await apiPostJson<{ id: number }>(request, tabToken, "/api/clients", {
      fullName: `E2E310 By Root ${Date.now()}`,
      phone: null,
      email: null,
      ruc: null,
    });
    expect(created.id).toBeGreaterThan(0);
  });

  test("S3: 'End impersonation' closes the tab and the platform tab keeps working", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tenant = await createTenantApi(request, platformToken, "End");

    await loginAsPlatformAdmin(page);
    const { tab } = await openAsAdministrator(page, tenant);

    const closed = tab.waitForEvent("close");
    await tab
      .getByTestId("impersonation-banner")
      .getByRole("button", { name: "End impersonation" })
      .click();
    await closed;
    expect(tab.isClosed()).toBe(true);

    // The Platform Admin is still signed in and can keep administering tenants.
    await page.keyboard.press("Escape");
    await page.goto("/platform/tenants");
    await expect(page).toHaveURL(/\/platform\/tenants$/);
    await expect(page.getByTestId(/^platform-tenant-row-/).first()).toBeVisible({ timeout: 15_000 });
  });

  test("S4: a suspended tenant can't be impersonated, and suspending one ends an open impersonation", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tenant = await createTenantApi(request, platformToken, "Suspended");

    // An impersonation opened while ACTIVE…
    const impToken = await impersonateApi(request, platformToken, tenant.id);
    const before = await request.get(`${apiBaseUrl()}/api/clients`, {
      headers: authHeaders(impToken),
    });
    expect(before.ok(), await before.text()).toBeTruthy();

    await setTenantStatusApi(request, platformToken, tenant.id, "SUSPENDED");

    // …dies on its next request once the tenant is suspended (same rule as HU-40 AC-3).
    const after = await request.get(`${apiBaseUrl()}/api/clients`, {
      headers: authHeaders(impToken),
    });
    expect([401, 403]).toContain(after.status());

    // API: a new impersonation is rejected with an explicit code.
    const res = await request.post(
      `${apiBaseUrl()}/api/platform/tenants/${tenant.id}/impersonation`,
      { headers: authHeaders(platformToken) },
    );
    expect(res.status()).toBe(409);
    expect(await res.text()).toContain("TENANT_SUSPENDED");

    // UI: the action is disabled, with the reason next to it.
    await loginAsPlatformAdmin(page);
    const dlg = await openTenantDialog(page, tenant);
    const section = dlg.getByTestId("platform-tenant-impersonation");
    const button = section.getByRole("button", { name: "Open as administrator" });
    await expect(button).toBeDisabled();
    await expect(section).toContainText("A suspended tenant can't be accessed. Reactivate it first.");
    await expect(button).toHaveAttribute("aria-describedby", "tenant-impersonation-suspended-hint");

    // Reactivated → available again.
    await setTenantStatusApi(request, platformToken, tenant.id, "ACTIVE");
    await page.keyboard.press("Escape");
    const dlg2 = await openTenantDialog(page, tenant);
    await expect(
      dlg2.getByTestId("platform-tenant-impersonation").getByRole("button", { name: "Open as administrator" }),
    ).toBeEnabled();
  });

  test("S5: only the Platform Admin may impersonate, and the impersonation token stays inside its tenant", async ({
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tenant = await createTenantApi(request, platformToken, "Acl");

    // A tenant administrator can't impersonate anyone (not even their own tenant).
    const demoToken = await loginAsDemoApi(request);
    const byTenantAdmin = await request.post(
      `${apiBaseUrl()}/api/platform/tenants/${tenant.id}/impersonation`,
      { headers: authHeaders(demoToken) },
    );
    expect([401, 403]).toContain(byTenantAdmin.status());
    const ownTenant = await request.post(
      `${apiBaseUrl()}/api/platform/tenants/${DEMO_TENANT_ID}/impersonation`,
      { headers: authHeaders(demoToken) },
    );
    expect([401, 403]).toContain(ownTenant.status());

    // Anonymous: rejected.
    const anonymous = await request.post(
      `${apiBaseUrl()}/api/platform/tenants/${tenant.id}/impersonation`,
    );
    expect([401, 403]).toContain(anonymous.status());

    // Unknown tenant: 404 with an explicit code.
    const unknown = await request.post(
      `${apiBaseUrl()}/api/platform/tenants/999999999/impersonation`,
      { headers: authHeaders(platformToken) },
    );
    expect(unknown.status()).toBe(404);
    expect(await unknown.text()).toContain("TENANT_NOT_FOUND");

    const impToken = await impersonateApi(request, platformToken, tenant.id);

    // The impersonation token is a tenant ADMIN token: no platform route accepts it, so it can't
    // be used to impersonate further or to administer the platform.
    for (const path of ["/api/platform/tenants", "/api/platform/audit"]) {
      const res = await request.get(`${apiBaseUrl()}${path}`, { headers: authHeaders(impToken) });
      expect([401, 403], path).toContain(res.status());
    }
    const chained = await request.post(
      `${apiBaseUrl()}/api/platform/tenants/${DEMO_TENANT_ID}/impersonation`,
      { headers: authHeaders(impToken) },
    );
    expect([401, 403]).toContain(chained.status());

    // Isolation: a client of the DEMO tenant is invisible through the other tenant's token.
    const demoClient = await apiPostJson<{ id: number }>(request, demoToken, "/api/clients", {
      fullName: `E2E310 Isolation ${Date.now()}`,
      phone: null,
      email: null,
      ruc: null,
    });
    const crossTenant = await request.get(`${apiBaseUrl()}/api/clients/${demoClient.id}`, {
      headers: authHeaders(impToken),
    });
    expect(crossTenant.ok()).toBeFalsy();
    expect([403, 404]).toContain(crossTenant.status());
  });

  test("S6: the impersonation and everything done during it is audited under the Platform Admin", async ({
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const impToken = await impersonateApi(request, platformToken, DEMO_TENANT_ID);

    // Platform audit: who impersonated which tenant.
    const platformAuditRes = await request.get(
      `${apiBaseUrl()}/api/platform/audit?resource=tenants&size=20`,
      { headers: authHeaders(platformToken) },
    );
    expect(platformAuditRes.ok(), await platformAuditRes.text()).toBeTruthy();
    const startRow = ((await platformAuditRes.json()) as AuditPage).content.find(
      (r) => r.operation === "impersonation" && r.entityId === String(DEMO_TENANT_ID),
    );
    expect(startRow, "impersonation start row").toBeTruthy();
    expect(startRow!.userEmail).toBe(PLATFORM_ADMIN_EMAIL);
    expect(startRow!.userRole).toBe("PLATFORM_ADMIN");
    expect(startRow!.httpMethod).toBe("POST");

    // An action taken while impersonating…
    await apiPostJson<{ id: number }>(request, impToken, "/api/clients", {
      fullName: `E2E310 Audited ${Date.now()}`,
      phone: null,
      email: null,
      ruc: null,
    });

    // …shows up in the tenant's own audit trail (what the salon admin sees), attributed to the
    // Platform Admin — never to the salon's administrator.
    const demoToken = await loginAsDemoApi(request);
    const tenantAuditRes = await request.get(`${apiBaseUrl()}/api/audit?resource=clients&size=50`, {
      headers: authHeaders(demoToken),
    });
    expect(tenantAuditRes.ok(), await tenantAuditRes.text()).toBeTruthy();
    // Newest first; the suite runs on a single worker, so the latest "clients" row is ours (a
    // POST /api/clients carries no record id in its URL, so there's no entityId to match on).
    const row = ((await tenantAuditRes.json()) as AuditPage).content[0];
    expect(row, "audit row for the client created while impersonating").toBeTruthy();
    expect(row!.tenantId).toBe(DEMO_TENANT_ID);
    expect(row!.userEmail).toBe(PLATFORM_ADMIN_EMAIL);
    expect(row!.userEmail).not.toBe(DEMO_EMAIL);
    expect(row!.userRole).toBe("PLATFORM_ADMIN");
  });

  test("S7: /api/me flags the impersonation, refresh keeps it, and the password can't be changed from it", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tenant = await createTenantApi(request, platformToken, "Session");
    const impToken = await impersonateApi(request, platformToken, tenant.id);

    const meRes = await request.get(`${apiBaseUrl()}/api/me`, { headers: authHeaders(impToken) });
    expect(meRes.ok(), await meRes.text()).toBeTruthy();
    const me = (await meRes.json()) as {
      tenantId: number;
      tenantName: string;
      role: string;
      email: string;
      impersonation: boolean;
    };
    expect(me).toMatchObject({
      tenantId: tenant.id,
      tenantName: tenant.name,
      role: "ADMIN",
      email: PLATFORM_ADMIN_EMAIL,
      impersonation: true,
    });

    // A regular session is not flagged.
    const demoMe = (await (
      await request.get(`${apiBaseUrl()}/api/me`, { headers: authHeaders(await loginAsDemoApi(request)) })
    ).json()) as { impersonation: boolean };
    expect(demoMe.impersonation).toBe(false);

    // Sliding refresh keeps the tenant and the impersonation flag.
    const refreshRes = await request.post(`${apiBaseUrl()}/api/auth/refresh`, {
      headers: authHeaders(impToken),
    });
    expect(refreshRes.ok(), await refreshRes.text()).toBeTruthy();
    const refreshed = ((await refreshRes.json()) as TokenResponse).accessToken;
    const claims = decodeJwtPayload(refreshed);
    expect(claims.tid).toBe(tenant.id);
    expect(claims.role).toBe("ADMIN");
    expect(claims.imp).toBe(true);

    // Changing "my" password would change the Platform Admin's own credentials: blocked.
    const pwRes = await request.post(`${apiBaseUrl()}/api/me/change-password`, {
      headers: authHeaders(refreshed),
      data: { newPassword: "Another.Pass.2026!" },
    });
    expect(pwRes.status()).toBe(403);
    expect(await pwRes.text()).toContain("IMPERSONATION_ACTION_NOT_ALLOWED");
    // …and the Platform Admin's password is unchanged.
    expect(await loginPlatformAdminApi(request)).toBeTruthy();

    // UI: the user menu offers no "Change password" entry while impersonating.
    await loginAsPlatformAdmin(page);
    const { tab } = await openAsAdministrator(page, tenant);
    await tab.getByRole("button", { name: "Open user menu" }).click();
    await expect(tab.getByText("User settings", { exact: true })).toBeVisible();
    await expect(tab.getByText("Change password", { exact: true })).toHaveCount(0);
  });

  test("S8: a broken impersonation link explains itself instead of opening a session", async ({
    page,
  }) => {
    await page.goto("/impersonate");
    await expect(
      page.getByText(
        "This impersonation link is invalid or has expired. Start it again from the tenants list.",
      ),
    ).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem("accessToken"))).toBeNull();
    await page.getByRole("link", { name: "Go to sign in" }).click();
    await expect(page).toHaveURL(/\/login/);
  });
});
