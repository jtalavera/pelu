import { expect, test, type APIRequestContext } from "@playwright/test";
import { apiBaseUrl, authHeaders, loginAsDemoApi, loginPlatformAdminApi } from "../fixtures/api";
import { DEMO_EMAIL, DEMO_PASSWORD, loginAsPlatformAdmin } from "../fixtures/auth";

// HU-40 · Suspender / reactivar un tenant
// requirements/multi-tenant/HU-40-suspender-reactivar-tenant.md
//
// AC-1/AC-4/AC-6 (the suspend/reactivate action, and the resulting status shown in the listing and
// the tenant "detail" — the edit dialog, there's no separate detail page yet) are exercised against
// a disposable tenant created just for this spec via the platform API.
//
// AC-2/AC-3/AC-5 (login blocked, an already-active session invalidated on its next request, and
// business data left untouched) need a tenant with an actual login-capable user *and* business
// data. There is no API yet to provision a brand-new tenant's first admin user (that's a later
// onboarding story, not part of Épica B), so those ACs run against the seeded DEMO tenant (id=1,
// isabelzymanscki@gmail.com), which already has both. This whole e2e suite runs on a single
// Playwright worker (workers: 1, see playwright.config.ts), so temporarily suspending the shared
// demo tenant inside one test is safe — no other spec's page/API calls can interleave — and the
// test restores it to ACTIVE in a `finally` block so a failed assertion here can't strand later
// specs with a suspended demo tenant.

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
  return (await res.json()) as { id: number; name: string; status: string };
}

async function firstTierId(request: APIRequestContext, platformToken: string): Promise<number> {
  const tiersRes = await request.get(`${apiBaseUrl()}/api/platform/tenants/tiers`, {
    headers: authHeaders(platformToken),
  });
  const tiers = (await tiersRes.json()) as Array<{ id: number; name: string }>;
  expect(tiers.length).toBeGreaterThan(0);
  return tiers[0].id;
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
  return (await res.json()) as { id: number; status: string };
}

test.describe("HU-40 · Suspender / reactivar un tenant", () => {
  // AC-1/AC-6: the Platform Admin suspends a tenant from its detail (edit dialog); the new status
  // is visible immediately both in the listing and in the detail dialog itself.
  test("AC1+AC6: suspending a tenant updates its status in the listing and the detail dialog", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tierId = await firstTierId(request, platformToken);
    const tenant = await createTenantViaApi(request, platformToken, {
      name: `E2E Suspend ${Date.now()}`,
      domain: null,
      tierId,
    });

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/tenants");
    const row = page.getByTestId(`platform-tenant-row-${tenant.id}`);
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.getByText("Active", { exact: true })).toBeVisible();

    await row.click();
    const dlg = page.getByRole("dialog", { name: "Edit tenant" });
    await expect(dlg).toBeVisible();
    await expect(dlg.getByText("Active", { exact: true })).toBeVisible();
    await dlg.getByRole("button", { name: "Suspend tenant" }).click();

    const confirmDlg = page.getByRole("dialog", { name: "Suspend tenant?" });
    await expect(confirmDlg).toBeVisible();
    await expect(confirmDlg).toContainText(tenant.name);
    await confirmDlg.getByRole("button", { name: "Suspend tenant" }).click();

    await expect(dlg).toBeHidden();
    await expect(
      page.getByRole("alert").filter({ hasText: "Tenant suspended." }),
    ).toBeVisible();
    await expect(
      page.getByTestId(`platform-tenant-row-${tenant.id}`).getByText("Suspended", { exact: true }),
    ).toBeVisible();
  });

  // AC-4: reactivating a suspended tenant restores its status immediately, everywhere it's shown.
  test("AC4: reactivating a suspended tenant restores its status to Active", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tierId = await firstTierId(request, platformToken);
    const tenant = await createTenantViaApi(request, platformToken, {
      name: `E2E Reactivate ${Date.now()}`,
      domain: null,
      tierId,
    });
    await setTenantStatusApi(request, platformToken, tenant.id, "SUSPENDED");

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/tenants");
    const row = page.getByTestId(`platform-tenant-row-${tenant.id}`);
    await expect(row.getByText("Suspended", { exact: true })).toBeVisible({ timeout: 10_000 });

    await row.click();
    const dlg = page.getByRole("dialog", { name: "Edit tenant" });
    await expect(dlg).toBeVisible();
    await dlg.getByRole("button", { name: "Reactivate tenant" }).click();

    const confirmDlg = page.getByRole("dialog", { name: "Reactivate tenant?" });
    await expect(confirmDlg).toBeVisible();
    await confirmDlg.getByRole("button", { name: "Reactivate tenant" }).click();

    await expect(dlg).toBeHidden();
    await expect(
      page.getByRole("alert").filter({ hasText: "Tenant reactivated." }),
    ).toBeVisible();
    await expect(
      page.getByTestId(`platform-tenant-row-${tenant.id}`).getByText("Active", { exact: true }),
    ).toBeVisible();
  });

  // PRD "Auditoría": a status change is recorded with who and when, following the same pattern as
  // HU-38's tier-change audit, and surfaced back in the detail dialog.
  test("Audit: a status change records who and when, shown in the detail dialog", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tierId = await firstTierId(request, platformToken);
    const tenant = await createTenantViaApi(request, platformToken, {
      name: `E2E Audit Status ${Date.now()}`,
      domain: null,
      tierId,
    });

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/tenants");
    await page.getByTestId(`platform-tenant-row-${tenant.id}`).click();
    let dlg = page.getByRole("dialog", { name: "Edit tenant" });
    // No prior status change yet.
    await expect(page.getByTestId("tenant-edit-last-status-change")).toHaveCount(0);

    await dlg.getByRole("button", { name: "Suspend tenant" }).click();
    await page.getByRole("dialog", { name: "Suspend tenant?" }).getByRole("button", { name: "Suspend tenant" }).click();
    await expect(dlg).toBeHidden();

    await page.getByTestId(`platform-tenant-row-${tenant.id}`).click();
    dlg = page.getByRole("dialog", { name: "Edit tenant" });
    const history = page.getByTestId("tenant-edit-last-status-change");
    await expect(history).toBeVisible();
    await expect(history).toContainText("Active");
    await expect(history).toContainText("Suspended");
  });

  // AC-2/AC-3/AC-4/AC-5: the full suspend → blocked login/invalidated session → reactivate → login
  // restored → data untouched cycle, against the seeded DEMO tenant (see file header for why).
  test("AC2+AC3+AC4+AC5: suspension blocks login and invalidates an active session without touching business data; reactivation restores login", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    try {
      // Baseline, while ACTIVE: a normal login, and a snapshot of tenant-scoped business data.
      const tokenBefore = await loginAsDemoApi(request);
      const clientsBefore = await request.get(`${apiBaseUrl()}/api/clients`, {
        headers: authHeaders(tokenBefore),
      });
      expect(clientsBefore.ok(), await clientsBefore.text()).toBeTruthy();
      const clientsBeforeBody = await clientsBefore.json();
      const professionalsBefore = await request.get(`${apiBaseUrl()}/api/professionals`, {
        headers: authHeaders(tokenBefore),
      });
      expect(professionalsBefore.ok(), await professionalsBefore.text()).toBeTruthy();
      const professionalsBeforeBody = await professionalsBefore.json();

      // Suspend the tenant.
      await setTenantStatusApi(request, platformToken, 1, "SUSPENDED");

      // AC-3: the token issued *before* suspension — still validly signed and unexpired — is
      // rejected on its very next request; the session doesn't stay active indefinitely.
      const afterSuspendCall = await request.get(`${apiBaseUrl()}/api/clients`, {
        headers: authHeaders(tokenBefore),
      });
      expect(afterSuspendCall.ok()).toBeFalsy();
      expect([401, 403]).toContain(afterSuspendCall.status());

      // AC-2: a fresh login attempt against the now-suspended tenant fails with the exact same
      // response (status + body) as a login attempt with a wrong password — no enumeration signal.
      const suspendedLoginRes = await request.post(`${apiBaseUrl()}/api/auth/login`, {
        data: { email: DEMO_EMAIL, password: DEMO_PASSWORD },
      });
      const wrongPasswordRes = await request.post(`${apiBaseUrl()}/api/auth/login`, {
        data: { email: DEMO_EMAIL, password: "definitely-wrong-password" },
      });
      expect(suspendedLoginRes.status()).toBe(401);
      expect(wrongPasswordRes.status()).toBe(suspendedLoginRes.status());
      expect(await wrongPasswordRes.text()).toBe(await suspendedLoginRes.text());

      // AC-2 (UI): the login screen shows the same generic error it shows for bad credentials —
      // never a "tenant suspended"-specific message.
      await page.goto("/login");
      await page.getByLabel("Email").fill(DEMO_EMAIL);
      await page.getByLabel("Password").fill(DEMO_PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page.getByText("Email or password is incorrect.")).toBeVisible();
      await expect(page).toHaveURL(/\/login/);

      // AC-4: reactivating restores access immediately — no new credentials, no waiting.
      await setTenantStatusApi(request, platformToken, 1, "ACTIVE");
      const tokenAfter = await loginAsDemoApi(request);
      expect(tokenAfter).toBeTruthy();

      // AC-5: business data is exactly as it was before the suspend/reactivate cycle.
      const clientsAfter = await request.get(`${apiBaseUrl()}/api/clients`, {
        headers: authHeaders(tokenAfter),
      });
      expect(clientsAfter.ok(), await clientsAfter.text()).toBeTruthy();
      expect(await clientsAfter.json()).toEqual(clientsBeforeBody);
      const professionalsAfter = await request.get(`${apiBaseUrl()}/api/professionals`, {
        headers: authHeaders(tokenAfter),
      });
      expect(professionalsAfter.ok(), await professionalsAfter.text()).toBeTruthy();
      expect(await professionalsAfter.json()).toEqual(professionalsBeforeBody);
    } finally {
      // Always leave the shared demo tenant ACTIVE for every other spec in this suite.
      await setTenantStatusApi(request, platformToken, 1, "ACTIVE");
    }
  });
});
