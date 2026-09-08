import { expect, test, type APIRequestContext } from "@playwright/test";
import { apiBaseUrl, authHeaders, loginPlatformAdminApi } from "../fixtures/api";
import { loginAsPlatformAdmin } from "../fixtures/auth";

// HU-43 · Desactivar / reactivar un usuario de un tenant
// requirements/multi-tenant/HU-43-desactivar-reactivar-usuario-de-tenant.md
//
// AC-1 (acción de desactivación desde el listado de HU-42) and AC-3's UI surface (badge/button
// change to Disabled/Active) are exercised through the UI, against a disposable tenant with a
// freshly invited-and-activated admin.
//
// AC-2 (bloqueo de login individual, sin afectar a otros usuarios del tenant), AC-3's actual login
// restoration, AC-4 (sesión activa invalidada en la siguiente petición) and AC-5 (datos intactos:
// ni historial ni asignaciones se pierden) are exercised directly against the API for precision.
// The login-dependent tests (AC-2, AC-3's login check, AC-4) run against the seeded DEMO tenant
// (id=1) rather than a disposable one — login only resolves a tenant from the request's Origin
// header (AuthService#resolveTenant), which Playwright's `request` fixture never sends; the
// dev/e2e backend config only maps that header to the DEMO tenant. Same workaround HU-41/HU-42's
// login-dependent tests use.

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
  return (await res.json()) as { id: number; name: string };
}

async function firstTierId(request: APIRequestContext, platformToken: string): Promise<number> {
  const tiersRes = await request.get(`${apiBaseUrl()}/api/platform/tenants/tiers`, {
    headers: authHeaders(platformToken),
  });
  const tiers = (await tiersRes.json()) as Array<{ id: number; name: string }>;
  expect(tiers.length).toBeGreaterThan(0);
  return tiers[0].id;
}

async function createTenantAdminViaApi(
  request: APIRequestContext,
  platformToken: string,
  tenantId: number,
  email: string,
) {
  const res = await request.post(`${apiBaseUrl()}/api/platform/tenants/${tenantId}/admins`, {
    headers: authHeaders(platformToken),
    data: { email },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as { userId: number; email: string; rawToken: string };
}

async function activateViaApi(request: APIRequestContext, rawToken: string, password: string) {
  const res = await request.post(`${apiBaseUrl()}/api/auth/activate`, {
    data: { token: rawToken, password, confirmPassword: password },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

async function loginViaApi(request: APIRequestContext, email: string, password: string) {
  return request.post(`${apiBaseUrl()}/api/auth/login`, { data: { email, password } });
}

async function setUserStatusViaApi(
  request: APIRequestContext,
  platformToken: string,
  tenantId: number,
  userId: number,
  enabled: boolean,
) {
  const res = await request.patch(
    `${apiBaseUrl()}/api/platform/tenants/${tenantId}/admins/${userId}/status`,
    {
      headers: authHeaders(platformToken),
      data: { enabled },
    },
  );
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as {
    userId: number;
    email: string;
    role: string;
    enabled: boolean;
    activated: boolean;
  };
}

async function listTenantAdminsViaApi(
  request: APIRequestContext,
  platformToken: string,
  tenantId: number,
) {
  const res = await request.get(`${apiBaseUrl()}/api/platform/tenants/${tenantId}/admins`, {
    headers: authHeaders(platformToken),
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as Array<{
    userId: number;
    email: string;
    role: string;
    enabled: boolean;
    activated: boolean;
  }>;
}

test.describe("HU-43 · Desactivar / reactivar un usuario de un tenant", () => {
  // AC-1: from the tenant's user list (HU-42), the Platform Admin deactivates one user; the row
  // reflects the new "Disabled" status immediately.
  test("AC1: Platform Admin deactivates a single user from the tenant's user list", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tierId = await firstTierId(request, platformToken);
    const tenant = await createTenantViaApi(request, platformToken, {
      name: `E2E Deactivate ${Date.now()}`,
      domain: null,
      tierId,
    });
    const email = `deactivate-ui-${Date.now()}@e2e-tenant.test`;
    const admin = await createTenantAdminViaApi(request, platformToken, tenant.id, email);
    await activateViaApi(request, admin.rawToken, "ValidPassUi1!");

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/tenants");
    await page.getByTestId(`platform-tenant-row-${tenant.id}`).click();
    const dlg = page.getByRole("dialog", { name: "Edit tenant" });
    await expect(dlg).toBeVisible();

    const row = dlg.getByTestId(`tenant-user-row-${admin.userId}`);
    await expect(row).toBeVisible();
    await expect(row.getByText("Active", { exact: true })).toBeVisible();

    await row.getByRole("button", { name: "Deactivate" }).click();
    const confirmDlg = page.getByRole("dialog", { name: "Deactivate user" });
    await expect(confirmDlg).toBeVisible();
    await expect(confirmDlg).toContainText(email);
    await confirmDlg.getByRole("button", { name: "Deactivate" }).click();

    await expect(dlg.getByText(`${email} was deactivated.`)).toBeVisible();
    await expect(row.getByText("Disabled", { exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: "Reactivate" })).toBeVisible();
  });

  // AC-3: reactivating a previously deactivated user restores their "Active" status and button in
  // the UI. The full "login restored" proof (which needs a login-capable tenant, see below) is
  // covered by the AC2 test's final step.
  test("AC3: Platform Admin reactivates a previously deactivated user", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tierId = await firstTierId(request, platformToken);
    const tenant = await createTenantViaApi(request, platformToken, {
      name: `E2E Reactivate User ${Date.now()}`,
      domain: null,
      tierId,
    });
    const email = `reactivate-ui-${Date.now()}@e2e-tenant.test`;
    const admin = await createTenantAdminViaApi(request, platformToken, tenant.id, email);
    await activateViaApi(request, admin.rawToken, "ValidPassUi1!");
    await setUserStatusViaApi(request, platformToken, tenant.id, admin.userId, false);

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/tenants");
    await page.getByTestId(`platform-tenant-row-${tenant.id}`).click();
    const dlg = page.getByRole("dialog", { name: "Edit tenant" });
    await expect(dlg).toBeVisible();

    const row = dlg.getByTestId(`tenant-user-row-${admin.userId}`);
    await expect(row.getByText("Disabled", { exact: true })).toBeVisible();

    await row.getByRole("button", { name: "Reactivate" }).click();
    const confirmDlg = page.getByRole("dialog", { name: "Reactivate user" });
    await expect(confirmDlg).toBeVisible();
    await confirmDlg.getByRole("button", { name: "Reactivate" }).click();

    await expect(dlg.getByText(`${email} was reactivated.`)).toBeVisible();
    await expect(row.getByText("Active", { exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: "Deactivate" })).toBeVisible();
  });

  // AC-2/AC-3: deactivating one user blocks *only* their own login — the response is
  // indistinguishable from a wrong-password attempt (no enumeration signal) — while every other
  // user of the same tenant keeps logging in normally; reactivating then restores login with the
  // user's original password, no new credentials required.
  //
  // Login only resolves a tenant from the request's Origin header (see AuthService#resolveTenant),
  // which Playwright's `request` fixture never sends — so, like HU-41/HU-42's login-dependent
  // tests, this one runs against the seeded DEMO tenant (id=1), the one origin the dev/e2e backend
  // config maps to.
  test("AC2+AC3: deactivating one user blocks only their own login (others unaffected), reactivating restores it", async ({
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const emailA = `blockA-${Date.now()}@e2e-tenant.test`;
    const emailB = `blockB-${Date.now()}@e2e-tenant.test`;
    const adminA = await createTenantAdminViaApi(request, platformToken, 1, emailA);
    const adminB = await createTenantAdminViaApi(request, platformToken, 1, emailB);
    await activateViaApi(request, adminA.rawToken, "ValidPassA1!");
    await activateViaApi(request, adminB.rawToken, "ValidPassB1!");

    // Baseline: both log in fine while active.
    expect((await loginViaApi(request, emailA, "ValidPassA1!")).ok()).toBeTruthy();
    expect((await loginViaApi(request, emailB, "ValidPassB1!")).ok()).toBeTruthy();

    await setUserStatusViaApi(request, platformToken, 1, adminA.userId, false);

    const blockedLoginRes = await loginViaApi(request, emailA, "ValidPassA1!");
    const wrongPasswordRes = await loginViaApi(request, emailA, "definitely-wrong-password");
    expect(blockedLoginRes.status()).toBe(401);
    expect(wrongPasswordRes.status()).toBe(blockedLoginRes.status());
    expect(await wrongPasswordRes.text()).toBe(await blockedLoginRes.text());

    // The other admin of the same tenant is entirely unaffected.
    const stillOkLoginB = await loginViaApi(request, emailB, "ValidPassB1!");
    expect(stillOkLoginB.ok(), await stillOkLoginB.text()).toBeTruthy();

    // AC-3: reactivating restores login immediately, with the user's original password.
    await setUserStatusViaApi(request, platformToken, 1, adminA.userId, true);
    const restoredLoginRes = await loginViaApi(request, emailA, "ValidPassA1!");
    expect(restoredLoginRes.ok(), await restoredLoginRes.text()).toBeTruthy();
  });

  // AC-4: a token issued before deactivation — still validly signed and unexpired — is rejected on
  // its very next request; the open session doesn't stay usable. Same DEMO-tenant workaround as
  // the AC2+AC3 test above (login needs an Origin-resolvable tenant).
  test("AC4: deactivating a user with an open session invalidates it on the very next request", async ({
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const email = `session-${Date.now()}@e2e-tenant.test`;
    const admin = await createTenantAdminViaApi(request, platformToken, 1, email);
    await activateViaApi(request, admin.rawToken, "ValidPassS1!");

    const loginRes = await loginViaApi(request, email, "ValidPassS1!");
    expect(loginRes.ok(), await loginRes.text()).toBeTruthy();
    const { accessToken } = (await loginRes.json()) as { accessToken: string };

    // The token works before deactivation.
    const beforeCall = await request.get(`${apiBaseUrl()}/api/clients`, {
      headers: authHeaders(accessToken),
    });
    expect(beforeCall.ok(), await beforeCall.text()).toBeTruthy();

    await setUserStatusViaApi(request, platformToken, 1, admin.userId, false);

    // The very same still-valid token is rejected on the next request — no new token was issued.
    const afterCall = await request.get(`${apiBaseUrl()}/api/clients`, {
      headers: authHeaders(accessToken),
    });
    expect(afterCall.ok()).toBeFalsy();
    expect([401, 403]).toContain(afterCall.status());
  });

  // AC-5: deactivating (and reactivating) a user changes only its enabled flag — the same AppUser
  // row (same id, email, role) persists throughout, and it isn't reassigned to anyone else.
  test("AC5: deactivating and reactivating a user doesn't delete its record or reassign it", async ({
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tierId = await firstTierId(request, platformToken);
    const tenant = await createTenantViaApi(request, platformToken, {
      name: `E2E Data Intact ${Date.now()}`,
      domain: null,
      tierId,
    });
    const email = `intact-${Date.now()}@e2e-tenant.test`;
    const admin = await createTenantAdminViaApi(request, platformToken, tenant.id, email);
    await activateViaApi(request, admin.rawToken, "ValidPassI1!");

    const before = await listTenantAdminsViaApi(request, platformToken, tenant.id);
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({
      userId: admin.userId,
      email,
      role: "ADMIN",
      enabled: true,
    });

    const afterDeactivate = await setUserStatusViaApi(
      request,
      platformToken,
      tenant.id,
      admin.userId,
      false,
    );
    expect(afterDeactivate).toMatchObject({
      userId: admin.userId,
      email,
      role: "ADMIN",
      enabled: false,
      // AC-5 supporting detail: the user had already activated, so it's genuinely "disabled" —
      // distinct from a never-activated invite still "pending activation".
      activated: true,
    });

    const afterReactivate = await setUserStatusViaApi(
      request,
      platformToken,
      tenant.id,
      admin.userId,
      true,
    );
    expect(afterReactivate).toMatchObject({
      userId: admin.userId,
      email,
      role: "ADMIN",
      enabled: true,
    });

    // Still the only user of this tenant — no duplicate, no reassignment to a different row.
    const after = await listTenantAdminsViaApi(request, platformToken, tenant.id);
    expect(after).toHaveLength(1);
    expect(after[0].userId).toBe(admin.userId);
  });
});
