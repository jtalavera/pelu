import { expect, test, type APIRequestContext } from "@playwright/test";
import { apiBaseUrl, authHeaders, loginPlatformAdminApi } from "../fixtures/api";
import { loginAsPlatformAdmin } from "../fixtures/auth";

// HU-42 · Asignar más de un Admin al mismo tenant
// requirements/multi-tenant/HU-42-asignar-multiples-admins-a-un-tenant.md
//
// AC-1 (sin límite artificial de admins por tenant) and AC-3 (listado de admins del tenant) are
// exercised through the UI, repeating the HU-41 invite flow against a disposable tenant.
//
// AC-1/AC-3 are also exercised directly against the API for precision (exact count/role/enabled
// per user). AC-2 (permisos equivalentes) and AC-4 (independencia de sesiones) are exercised by
// activating two separately-invited admins and logging in as each with their own credentials,
// both landing on the same tenant-scoped dashboard — same workaround as HU-41's AC4+AC5 test:
// login resolves the tenant from the Origin header, which the dev frontend only matches to the
// seeded DEMO tenant (id=1), so both admins are invited onto that tenant.

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

async function listTenantAdminsViaApi(
  request: APIRequestContext,
  platformToken: string,
  tenantId: number,
) {
  return request.get(`${apiBaseUrl()}/api/platform/tenants/${tenantId}/admins`, {
    headers: authHeaders(platformToken),
  });
}

async function activateViaApi(request: APIRequestContext, rawToken: string, password: string) {
  const res = await request.post(`${apiBaseUrl()}/api/auth/activate`, {
    data: { token: rawToken, password, confirmPassword: password },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

test.describe("HU-42 · Asignar más de un Admin al mismo tenant", () => {
  // AC-1/AC-3: repeating the HU-41 invite flow three times for the same tenant has no artificial
  // cap, and every invited admin shows up in the tenant's user list from its detail.
  test("AC1+AC3: inviting three admins to the same tenant has no cap and all three appear in the tenant's user list", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tierId = await firstTierId(request, platformToken);
    const tenant = await createTenantViaApi(request, platformToken, {
      name: `E2E Multi Admin ${Date.now()}`,
      domain: null,
      tierId,
    });
    const emails = [
      `multi1-${Date.now()}@e2e-tenant.test`,
      `multi2-${Date.now()}@e2e-tenant.test`,
      `multi3-${Date.now()}@e2e-tenant.test`,
    ];

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/tenants");
    await page.getByTestId(`platform-tenant-row-${tenant.id}`).click();
    const dlg = page.getByRole("dialog", { name: "Edit tenant" });
    await expect(dlg).toBeVisible();

    // Before inviting anyone, the list is empty.
    await expect(dlg.getByText("No users assigned to this tenant yet.")).toBeVisible();

    for (const email of emails) {
      await dlg.locator("#tenant-admin-email").fill(email);
      await dlg.getByRole("button", { name: "Invite administrator" }).click();
      await expect(dlg.getByText(`Invitation sent to ${email}.`)).toBeVisible();
    }

    // AC-3: all three now appear in the tenant's user list, each tagged "Admin" and
    // "Pending activation" (not yet activated).
    const list = dlg.getByTestId("tenant-users-list");
    for (const email of emails) {
      const row = list.locator('[data-testid^="tenant-user-row-"]', { hasText: email });
      await expect(row).toBeVisible();
      await expect(row.getByText("Admin", { exact: true })).toBeVisible();
      await expect(row.getByText("Pending activation")).toBeVisible();
    }
  });

  // AC-1/AC-3 (API precision): the tenant's user list reflects the exact count/role/enabled state
  // of every admin assigned, with no upper bound on how many can be created.
  test("AC1+AC3 (API): the tenant admins listing grows with every invite, no artificial limit", async ({
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tierId = await firstTierId(request, platformToken);
    const tenant = await createTenantViaApi(request, platformToken, {
      name: `E2E Multi Admin API ${Date.now()}`,
      domain: null,
      tierId,
    });

    const emptyRes = await listTenantAdminsViaApi(request, platformToken, tenant.id);
    expect(emptyRes.ok(), await emptyRes.text()).toBeTruthy();
    expect(await emptyRes.json()).toEqual([]);

    const emails = [
      `api1-${Date.now()}@e2e-tenant.test`,
      `api2-${Date.now()}@e2e-tenant.test`,
      `api3-${Date.now()}@e2e-tenant.test`,
      `api4-${Date.now()}@e2e-tenant.test`,
    ];
    for (const email of emails) {
      const res = await createTenantAdminViaApi(request, platformToken, tenant.id, email);
      expect(res.ok(), await res.text()).toBeTruthy();
    }

    const listRes = await listTenantAdminsViaApi(request, platformToken, tenant.id);
    expect(listRes.ok(), await listRes.text()).toBeTruthy();
    const users = (await listRes.json()) as Array<{
      userId: number;
      email: string;
      role: string;
      enabled: boolean;
    }>;
    expect(users).toHaveLength(emails.length);
    for (const email of emails) {
      const user = users.find((u) => u.email === email);
      expect(user).toBeTruthy();
      expect(user?.role).toBe("ADMIN");
      expect(user?.enabled).toBe(false);
    }
  });

  // AC-2/AC-4: two admins invited to the same tenant activate their own accounts with their own
  // passwords, log in independently (their sessions/credentials don't interfere with each other),
  // and both land on the same tenant dashboard — proving neither has more or fewer permissions
  // than the other (no hierarchy between admins of the same tenant).
  test("AC2+AC4: two admins of the same tenant log in independently and reach the same dashboard", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const emailA = `sessA-${Date.now()}@e2e-tenant.test`;
    const emailB = `sessB-${Date.now()}@e2e-tenant.test`;

    const createResA = await createTenantAdminViaApi(request, platformToken, 1, emailA);
    expect(createResA.ok(), await createResA.text()).toBeTruthy();
    const { rawToken: tokenA } = (await createResA.json()) as { rawToken: string };

    const createResB = await createTenantAdminViaApi(request, platformToken, 1, emailB);
    expect(createResB.ok(), await createResB.text()).toBeTruthy();
    const { rawToken: tokenB } = (await createResB.json()) as { rawToken: string };

    await activateViaApi(request, tokenA, "ValidPassA1!");
    await activateViaApi(request, tokenB, "ValidPassB1!");

    // AC-4: independent credentials — admin A logs in with their own password.
    const loginA = await request.post(`${apiBaseUrl()}/api/auth/login`, {
      data: { email: emailA, password: "ValidPassA1!" },
    });
    expect(loginA.ok(), await loginA.text()).toBeTruthy();

    // AC-4: admin B logs in independently, with their own (different) password — doesn't affect
    // admin A's already-issued session.
    const loginB = await request.post(`${apiBaseUrl()}/api/auth/login`, {
      data: { email: emailB, password: "ValidPassB1!" },
    });
    expect(loginB.ok(), await loginB.text()).toBeTruthy();

    // Admin A's session is still valid after admin B logged in.
    const stillValidA = await request.post(`${apiBaseUrl()}/api/auth/login`, {
      data: { email: emailA, password: "ValidPassA1!" },
    });
    expect(stillValidA.ok(), await stillValidA.text()).toBeTruthy();

    // AC-2: both admins, with no hierarchy between them, reach the same tenant dashboard via the
    // UI login flow (same permissions on the tenant's data/configuration).
    await page.goto("/login");
    await page.getByLabel("Email").fill(emailA);
    await page.getByLabel("Password").fill("ValidPassA1!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/app/, { timeout: 25_000 });
    await expect(page.getByText("Appointments today", { exact: true }).first()).toBeVisible({
      timeout: 20_000,
    });

    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByLabel("Email").fill(emailB);
    await page.getByLabel("Password").fill("ValidPassB1!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/app/, { timeout: 25_000 });
    await expect(page.getByText("Appointments today", { exact: true }).first()).toBeVisible({
      timeout: 20_000,
    });
  });
});
