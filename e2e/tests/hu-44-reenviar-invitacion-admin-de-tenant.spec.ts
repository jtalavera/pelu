import { expect, test, type APIRequestContext } from "@playwright/test";
import { apiBaseUrl, authHeaders, loginPlatformAdminApi } from "../fixtures/api";
import { loginAsPlatformAdmin } from "../fixtures/auth";

// HU-44 · Reenviar invitación / reseteo de contraseña para un admin de tenant
// requirements/multi-tenant/HU-44-reenviar-invitacion-admin-de-tenant.md
//
// AC-1 (reenvío de invitación para un usuario nunca activado) and AC-4's UI surface (confirmation
// shown) are exercised through the UI in the "never activated" test. AC-2 (reseteo de contraseña
// para un usuario ya activado) and its own AC-4 confirmation are exercised through the UI in the
// "already activated" test. AC-3 (un solo enlace válido — el anterior queda invalidado) is
// exercised directly against the API for precision, for both branches, including a full
// activate/reset-password/login cycle proving the *new* link actually works. AC-5 (sin exposición
// de contraseña) is checked structurally (no password input anywhere in this flow) alongside the
// UI tests. A disabled user (HU-43) is also confirmed to reject the resend, both via the hidden UI
// action and directly against the API.

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
}

async function resendInvitationViaApi(
  request: APIRequestContext,
  platformToken: string,
  tenantId: number,
  userId: number,
) {
  return request.post(
    `${apiBaseUrl()}/api/platform/tenants/${tenantId}/admins/${userId}/resend-invitation`,
    { headers: authHeaders(platformToken) },
  );
}

async function validateActivationTokenViaApi(request: APIRequestContext, rawToken: string) {
  return request.get(
    `${apiBaseUrl()}/api/auth/validate-activation-token?token=${rawToken}`,
  );
}

async function resetPasswordViaApi(
  request: APIRequestContext,
  rawToken: string,
  newPassword: string,
) {
  return request.post(`${apiBaseUrl()}/api/auth/reset-password`, {
    data: { token: rawToken, newPassword },
  });
}

test.describe("HU-44 · Reenviar invitación / reseteo de contraseña para un admin de tenant", () => {
  // AC-1/AC-4/AC-5: from the tenant's user list, resending for a user who never activated shows
  // the activation-invite confirmation and asks for no password anywhere in the flow.
  test("AC1+AC4+AC5: resending for a never-activated user shows the activation-invite confirmation", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tierId = await firstTierId(request, platformToken);
    const tenant = await createTenantViaApi(request, platformToken, {
      name: `E2E Resend Invite ${Date.now()}`,
      domain: null,
      tierId,
    });
    const email = `resend-invite-${Date.now()}@e2e-tenant.test`;
    const admin = await createTenantAdminViaApi(request, platformToken, tenant.id, email);

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/tenants");
    await page.getByTestId(`platform-tenant-row-${tenant.id}`).click();
    const dlg = page.getByRole("dialog", { name: "Edit tenant" });
    await expect(dlg).toBeVisible();

    const row = dlg.getByTestId(`tenant-user-row-${admin.userId}`);
    await expect(row).toBeVisible();
    await expect(row.getByText("Pending activation", { exact: true })).toBeVisible();

    // AC-5: no password input anywhere in this section, before or after resending.
    await expect(dlg.locator('input[type="password"]')).toHaveCount(0);

    await row.getByRole("button", { name: "Resend" }).click();

    // AC-4: confirmation that the correct email was resent.
    await expect(dlg.getByText(`Activation invite resent to ${email}.`)).toBeVisible();
    await expect(dlg.locator('input[type="password"]')).toHaveCount(0);
  });

  // AC-2/AC-4/AC-5: resending for a user who already activated their account shows the
  // password-reset confirmation instead — same action, different outcome based on activation
  // state, and still no password ever shown.
  test("AC2+AC4+AC5: resending for an already-activated user shows the password-reset confirmation", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tierId = await firstTierId(request, platformToken);
    const tenant = await createTenantViaApi(request, platformToken, {
      name: `E2E Resend Reset ${Date.now()}`,
      domain: null,
      tierId,
    });
    const email = `resend-reset-${Date.now()}@e2e-tenant.test`;
    const admin = await createTenantAdminViaApi(request, platformToken, tenant.id, email);
    await activateViaApi(request, admin.rawToken, "ValidPassReset1!");

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/tenants");
    await page.getByTestId(`platform-tenant-row-${tenant.id}`).click();
    const dlg = page.getByRole("dialog", { name: "Edit tenant" });
    await expect(dlg).toBeVisible();

    const row = dlg.getByTestId(`tenant-user-row-${admin.userId}`);
    await expect(row.getByText("Active", { exact: true })).toBeVisible();

    await expect(dlg.locator('input[type="password"]')).toHaveCount(0);
    await row.getByRole("button", { name: "Resend" }).click();

    await expect(dlg.getByText(`Password reset email sent to ${email}.`)).toBeVisible();
    await expect(dlg.locator('input[type="password"]')).toHaveCount(0);
  });

  // AC-1/AC-3: resending an activation invite invalidates the previous link — the old token stops
  // validating — and the newly issued one actually works end-to-end (activate + log in).
  test("AC1+AC3: resending an activation invite invalidates the previous link; the new one activates the account", async ({
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const email = `invite-invalidate-${Date.now()}@e2e-tenant.test`;
    // Tenant 1 (DEMO) so the final login step resolves via the Origin-less default, same
    // workaround HU-41/HU-43's login-dependent tests use.
    const admin = await createTenantAdminViaApi(request, platformToken, 1, email);

    const oldTokenBefore = await validateActivationTokenViaApi(request, admin.rawToken);
    expect(oldTokenBefore.ok(), await oldTokenBefore.text()).toBeTruthy();

    const resendRes = await resendInvitationViaApi(request, platformToken, 1, admin.userId);
    expect(resendRes.ok(), await resendRes.text()).toBeTruthy();
    const resendBody = (await resendRes.json()) as {
      userId: number;
      email: string;
      passwordReset: boolean;
      rawToken: string;
    };
    expect(resendBody.email).toBe(email);
    expect(resendBody.passwordReset).toBe(false);
    expect(resendBody.rawToken).toBeTruthy();
    expect(resendBody.rawToken).not.toBe(admin.rawToken);

    // The previous link is dead.
    const oldTokenAfter = await validateActivationTokenViaApi(request, admin.rawToken);
    expect(oldTokenAfter.status()).toBe(400);
    expect(await oldTokenAfter.text()).toContain("INVALID_TOKEN");

    // The new link works end-to-end.
    const newTokenCheck = await validateActivationTokenViaApi(request, resendBody.rawToken);
    expect(newTokenCheck.ok(), await newTokenCheck.text()).toBeTruthy();

    await activateViaApi(request, resendBody.rawToken, "ValidPassNewInvite1!");
    const loginRes = await loginViaApi(request, email, "ValidPassNewInvite1!");
    expect(loginRes.ok(), await loginRes.text()).toBeTruthy();
  });

  // AC-2/AC-3: triggering a password reset invalidates the previous still-unused reset link, and
  // the newly issued one actually lets the user set a new password and log in with it.
  test("AC2+AC3: triggering a password reset invalidates the previous reset link; the new one resets the password", async ({
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const email = `reset-invalidate-${Date.now()}@e2e-tenant.test`;
    const admin = await createTenantAdminViaApi(request, platformToken, 1, email);
    await activateViaApi(request, admin.rawToken, "OriginalPass1!");

    const firstResend = await resendInvitationViaApi(request, platformToken, 1, admin.userId);
    expect(firstResend.ok(), await firstResend.text()).toBeTruthy();
    const firstBody = (await firstResend.json()) as { passwordReset: boolean; rawToken: string };
    expect(firstBody.passwordReset).toBe(true);

    const secondResend = await resendInvitationViaApi(request, platformToken, 1, admin.userId);
    expect(secondResend.ok(), await secondResend.text()).toBeTruthy();
    const secondBody = (await secondResend.json()) as {
      passwordReset: boolean;
      rawToken: string;
    };
    expect(secondBody.passwordReset).toBe(true);
    expect(secondBody.rawToken).not.toBe(firstBody.rawToken);

    // AC-3: the first reset link no longer works once the second was issued.
    const staleReset = await resetPasswordViaApi(request, firstBody.rawToken, "StaleAttempt1!");
    expect(staleReset.status()).toBe(400);
    expect(await staleReset.text()).toContain("INVALID_TOKEN");

    // The latest link works end-to-end.
    const freshReset = await resetPasswordViaApi(request, secondBody.rawToken, "BrandNewPass1!");
    expect(freshReset.ok(), await freshReset.text()).toBeTruthy();

    const loginOld = await loginViaApi(request, email, "OriginalPass1!");
    expect(loginOld.status()).toBe(401);
    const loginNew = await loginViaApi(request, email, "BrandNewPass1!");
    expect(loginNew.ok(), await loginNew.text()).toBeTruthy();
  });

  // A user the Platform Admin deliberately disabled (HU-43) can't be resent an invite or a
  // password reset from here — the row hides the action, and the API rejects it directly too.
  test("a disabled user's resend action is hidden in the UI and rejected by the API", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tierId = await firstTierId(request, platformToken);
    const tenant = await createTenantViaApi(request, platformToken, {
      name: `E2E Resend Disabled ${Date.now()}`,
      domain: null,
      tierId,
    });
    const email = `resend-disabled-${Date.now()}@e2e-tenant.test`;
    const admin = await createTenantAdminViaApi(request, platformToken, tenant.id, email);
    await activateViaApi(request, admin.rawToken, "ValidPassDisabled1!");
    await setUserStatusViaApi(request, platformToken, tenant.id, admin.userId, false);

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/tenants");
    await page.getByTestId(`platform-tenant-row-${tenant.id}`).click();
    const dlg = page.getByRole("dialog", { name: "Edit tenant" });
    await expect(dlg).toBeVisible();

    const row = dlg.getByTestId(`tenant-user-row-${admin.userId}`);
    await expect(row.getByText("Disabled", { exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: "Resend" })).toHaveCount(0);
    await expect(row.getByRole("button", { name: "Reactivate" })).toBeVisible();

    const resendRes = await resendInvitationViaApi(
      request,
      platformToken,
      tenant.id,
      admin.userId,
    );
    expect(resendRes.status()).toBe(400);
    expect(await resendRes.text()).toContain("TENANT_USER_DISABLED_CANNOT_RESEND");
  });
});
