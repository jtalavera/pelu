import { expect, test, type APIRequestContext } from "@playwright/test";
import { apiBaseUrl, authHeaders, loginPlatformAdminApi } from "../fixtures/api";
import { loginAsPlatformAdmin } from "../fixtures/auth";

// HU-41 · Platform Admin crea un usuario y lo asigna a un tenant como Admin
// requirements/multi-tenant/HU-41-crear-usuario-admin-de-tenant.md
//
// AC-1 (formulario de alta), AC-2 (sin contraseña inicial visible), AC-4 (invitación por
// activación, mismo patrón que ProfessionalActivationToken/ActivatePage) and AC-6 (confirmación)
// are exercised through the UI, against a disposable tenant created via the platform API.
//
// AC-3 (email único por (tenant_id, email), pero permitido en tenants distintos) and AC-5 (no
// puede iniciar sesión hasta activarse) are exercised directly against the API for precision.

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
  return res;
}

test.describe("HU-41 · Platform Admin crea un usuario admin de tenant", () => {
  // AC-1/AC-2/AC-4/AC-6: from the tenant's detail (edit dialog), the Platform Admin invites a new
  // admin by email only (no password field anywhere in this flow) and sees a confirmation that the
  // invitation was sent.
  test("AC1+AC2+AC4+AC6: inviting a tenant admin from the tenant detail shows a confirmation and asks only for an email", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tierId = await firstTierId(request, platformToken);
    const tenant = await createTenantViaApi(request, platformToken, {
      name: `E2E Admin Invite ${Date.now()}`,
      domain: null,
      tierId,
    });
    const adminEmail = `admin${Date.now()}@e2e-tenant.test`;

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/tenants");
    await page.getByTestId(`platform-tenant-row-${tenant.id}`).click();
    const dlg = page.getByRole("dialog", { name: "Edit tenant" });
    await expect(dlg).toBeVisible();

    await expect(dlg.getByText("Tenant administrators")).toBeVisible();
    // AC-2: no password input anywhere in the invite section — only an email field.
    await expect(dlg.locator('input[type="password"]')).toHaveCount(0);

    await dlg.locator("#tenant-admin-email").fill(adminEmail);
    await dlg.getByRole("button", { name: "Invite administrator" }).click();

    await expect(dlg.getByText(`Invitation sent to ${adminEmail}.`)).toBeVisible();
    // The email field is cleared after a successful invite.
    await expect(dlg.locator("#tenant-admin-email")).toHaveValue("");
  });

  // AC-1/AC-3: creating a tenant admin assigns the ADMIN role for that tenant; a duplicate email
  // within the same tenant is rejected, but the same email is accepted for a different tenant.
  test("AC1+AC3: duplicate email within the same tenant is rejected; the same email is allowed on a different tenant", async ({
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tierId = await firstTierId(request, platformToken);
    const tenantA = await createTenantViaApi(request, platformToken, {
      name: `E2E Admin Dup A ${Date.now()}`,
      domain: null,
      tierId,
    });
    const tenantB = await createTenantViaApi(request, platformToken, {
      name: `E2E Admin Dup B ${Date.now()}`,
      domain: null,
      tierId,
    });
    const email = `dup${Date.now()}@e2e-tenant.test`;

    const firstRes = await createTenantAdminViaApi(request, platformToken, tenantA.id, email);
    expect(firstRes.ok(), await firstRes.text()).toBeTruthy();
    const firstBody = (await firstRes.json()) as { userId: number; email: string };
    expect(firstBody.email).toBe(email);

    const dupRes = await createTenantAdminViaApi(request, platformToken, tenantA.id, email);
    expect(dupRes.status()).toBe(409);
    expect(await dupRes.text()).toContain("TENANT_ADMIN_EMAIL_DUPLICATE");

    // Same email, different tenant: allowed.
    const otherTenantRes = await createTenantAdminViaApi(request, platformToken, tenantB.id, email);
    expect(otherTenantRes.ok(), await otherTenantRes.text()).toBeTruthy();
  });

  // AC-4/AC-5: the created user cannot log in until they complete activation via the emailed link
  // (same pattern as ProfessionalActivationToken/ActivatePage); once activated, they can log in as
  // an ADMIN of that tenant.
  //
  // Login resolves the tenant from the request's Origin header matched against Tenant.domain,
  // falling back to the seeded DEMO tenant (id=1) when nothing matches — and CORS only allows the
  // frontend dev origin (localhost:5173), so an arbitrary freshly-created tenant's own domain isn't
  // reachable from a plain API request here. Same workaround as HU-40's full login-cycle test: this
  // invites the admin onto the DEMO tenant itself and calls /api/auth/login with no Origin header at
  // all, which resolves to that same tenant by default.
  test("AC4+AC5: the invited admin cannot log in before activating, and can afterwards", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const email = `activate${Date.now()}@e2e-tenant.test`;

    const createRes = await createTenantAdminViaApi(request, platformToken, 1, email);
    expect(createRes.ok(), await createRes.text()).toBeTruthy();
    const { rawToken } = (await createRes.json()) as { rawToken: string };
    expect(rawToken).toBeTruthy();

    // AC-5: cannot log in yet — the account is disabled until activation.
    const loginBeforeRes = await request.post(`${apiBaseUrl()}/api/auth/login`, {
      data: { email, password: "WhateverPass1!" },
    });
    expect(loginBeforeRes.status()).toBe(401);

    // AC-4: the same /activate flow used for professionals works for this token too.
    const validateRes = await request.get(
      `${apiBaseUrl()}/api/auth/validate-activation-token?token=${rawToken}`,
    );
    expect(validateRes.ok(), await validateRes.text()).toBeTruthy();
    const info = (await validateRes.json()) as {
      professionalId: number | null;
      professionalName: string | null;
      email: string;
    };
    expect(info.email).toBe(email);
    expect(info.professionalId).toBeNull();

    await page.goto(`/activate?token=${rawToken}`);
    await page.locator("#activate-password").fill("ValidPass1!");
    await page.locator("#activate-confirm-password").fill("ValidPass1!");
    await page.getByRole("button", { name: "Set password" }).click();
    await expect(page.getByText(/Password set successfully/i)).toBeVisible();

    // Now the admin can log in with the password they chose themselves.
    const loginAfterRes = await request.post(`${apiBaseUrl()}/api/auth/login`, {
      data: { email, password: "ValidPass1!" },
    });
    expect(loginAfterRes.ok(), await loginAfterRes.text()).toBeTruthy();
  });
});
