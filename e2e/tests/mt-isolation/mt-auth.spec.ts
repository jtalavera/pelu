import { expect, test } from "@playwright/test";

import { API_BASE, authHeaders, decodeJwtPayload } from "../../fixtures/api";
import { loginAs, loginAsPlatformAdmin } from "../../fixtures/auth";
import { getMtWorld, mtLoginToken, mtPlatformToken } from "../../fixtures/mt/world";

/**
 * Task 4 — mt-auth: identity & routing isolation.
 *
 * Six scenarios proving that the single shared login screen keeps tenant identities apart:
 * role-based landing, per-tenant JWT `tid`, the TENANT_AMBIGUOUS guard, suspended-tenant login
 * blocking (+ restore), cross-area authorization, and forgot-password for a non-oldest tenant.
 *
 * All raw HTTP goes to `API_BASE` (= the :8081 mt backend — the mt config points
 * `PLAYWRIGHT_API_BASE_URL` there). Assertions are always "contains / excludes THIS id/value",
 * never an absolute count.
 */

const world = getMtWorld();

/** Login-screen init: mark guided tours seen (Joyride overlay blocks clicks) + force `en` copy. */
function markLoginScreenReady() {
  const PREFIX = "femme.tour.seen.";
  for (const k of [
    "billing",
    "business-settings",
    "calendar",
    "client-detail",
    "clients",
    "dashboard",
    "fiscal-stamp",
    "login",
    "professionals",
    "services",
  ]) {
    localStorage.setItem(PREFIX + k, "true");
  }
  localStorage.setItem("cursor_poc.i18n.language", "en");
}

test.describe("mt-auth · identity & routing isolation", () => {
  // Scenario 1 -----------------------------------------------------------------------------------
  test("AC: role-based landing + each tenant's own name in the header", async ({ page, browser }) => {
    test.setTimeout(90_000); // three full browser logins (platform admin + T-A + T-B contexts)

    // Platform admin lands on /platform (helper asserts URL + "Platform Admin" heading).
    await loginAsPlatformAdmin(page);

    // Each tenant admin lands on /app and sees ITS OWN tenant name in the top bar — and never the
    // other tenant's. `MeController` returns `tenant.getName()` as `tenantName`, which `AppShell`
    // renders in the top-bar logo span (src/frontend/src/layout/AppShell.tsx ~L279); that equals
    // `world.tenant*.name` exactly.
    for (const tenant of [world.tenantA, world.tenantB]) {
      const other = tenant.key === "A" ? world.tenantB : world.tenantA;
      const ctx = await browser.newContext();
      const p = await ctx.newPage();
      try {
        await loginAs(p, tenant.adminEmail, tenant.adminPassword);
        await expect(p).toHaveURL(/\/app/);
        await expect(p.getByText(tenant.name).first()).toBeVisible();
        await expect(p.getByText(other.name)).toHaveCount(0);
      } finally {
        await ctx.close();
      }
    }
  });

  // Scenario 2 -----------------------------------------------------------------------------------
  test("AC: JWT tid is per-tenant; platform admin token has none", async ({ request }) => {
    const tokenA = await mtLoginToken(request, world.tenantA);
    const tokenB = await mtLoginToken(request, world.tenantB);
    expect(Number(decodeJwtPayload(tokenA).tid)).toBe(world.tenantA.id);
    expect(Number(decodeJwtPayload(tokenB).tid)).toBe(world.tenantB.id);

    const platformToken = await mtPlatformToken(request);
    // AuthService mints the PLATFORM_ADMIN token with a null tenant → no `tid` claim at all.
    expect(decodeJwtPayload(platformToken).tid).toBeUndefined();
  });

  // Scenario 3 -----------------------------------------------------------------------------------
  test("AC: same email+password in two tenants → TENANT_AMBIGUOUS", async ({ page, request }) => {
    // API: no Origin header → AuthService gathers the email across all tenants; the shared password
    // is independently valid in A AND B → validMatches.size() > 1 → 401 TENANT_AMBIGUOUS.
    // DEVIATION from the brief's "200" mention: the real contract for a failed login is HTTP 401
    // (ResponseStatusException(UNAUTHORIZED, "TENANT_AMBIGUOUS")). Trusting the verified facts.
    const res = await request.post(`${API_BASE}/api/auth/login`, {
      data: { email: world.sharedAmbiguousEmail, password: world.sharedAmbiguousPassword },
    });
    expect(res.status()).toBe(401);
    expect(await res.text()).toContain("TENANT_AMBIGUOUS");

    // UI: the same creds on the single login screen surface the ambiguous-account copy and stay on
    // /login (no session established).
    await page.addInitScript(markLoginScreenReady);
    await page.goto("/login");
    await page.getByLabel("Email").fill(world.sharedAmbiguousEmail);
    await page.getByLabel("Password").fill(world.sharedAmbiguousPassword);
    const loginResp = page.waitForResponse(
      (r) => r.url().endsWith("/api/auth/login") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Sign in" }).click();
    expect((await loginResp).status()).toBe(401);

    // femme.apiErrors.TENANT_AMBIGUOUS (en.json) — verbatim.
    await expect(
      page.getByText(
        "Your account is linked to more than one business. Use the sign-in link specific to your business.",
      ),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  // Scenario 4 -----------------------------------------------------------------------------------
  // MUTATES T-C: reactivates it, then restores SUSPENDED in `finally` and asserts the restore.
  test("AC: suspended tenant blocks login; reactivation restores it", async ({ page, request }) => {
    test.setTimeout(60_000);

    const loginC = () =>
      request.post(`${API_BASE}/api/auth/login`, {
        data: { email: world.tenantC.adminEmail, password: world.tenantC.adminPassword },
      });

    // Baseline: T-C is SUSPENDED → its admin cannot log in.
    expect((await loginC()).status()).toBe(401);

    const platformToken = await mtPlatformToken(request);
    const setStatus = (status: "ACTIVE" | "SUSPENDED") =>
      request.patch(`${API_BASE}/api/platform/tenants/${world.tenantC.id}/status`, {
        headers: authHeaders(platformToken),
        data: { status },
      });

    try {
      const activate = await setStatus("ACTIVE");
      expect(activate.ok(), await activate.text()).toBeTruthy();

      const ok = await loginC();
      expect(ok.ok(), await ok.text()).toBeTruthy();
      const body = (await ok.json()) as { accessToken: string };
      expect(body.accessToken).toBeTruthy();
      expect(Number(decodeJwtPayload(body.accessToken).tid)).toBe(world.tenantC.id);

      // UI: the reactivated tenant's admin now reaches /app through the same login screen.
      await loginAs(page, world.tenantC.adminEmail, world.tenantC.adminPassword);
      await expect(page).toHaveURL(/\/app/);
    } finally {
      const resuspend = await setStatus("SUSPENDED");
      expect(resuspend.ok(), await resuspend.text()).toBeTruthy();
    }

    // After the restore, T-C login is blocked again.
    expect((await loginC()).status()).toBe(401);
  });

  // Scenario 5 -----------------------------------------------------------------------------------
  test("AC: cross-area authorization is enforced both ways", async ({ request }) => {
    const tokenA = await mtLoginToken(request, world.tenantA);
    const platformToken = await mtPlatformToken(request);

    // A tenant admin cannot read the platform tenant registry.
    const platformList = await request.get(`${API_BASE}/api/platform/tenants`, {
      headers: authHeaders(tokenA),
    });
    expect([401, 403]).toContain(platformList.status());

    // A platform-admin token (no `tid`) cannot read a tenant business endpoint — there is no
    // ambient tenant to scope the query to. Discovery: observe the real status; a 200 with data
    // would be an isolation finding (reported, not papered over).
    const appts = await request.get(`${API_BASE}/api/appointments`, {
      headers: authHeaders(platformToken),
    });
    const apptsBody = (await appts.text()).slice(0, 300);
    test.info().annotations.push({
      type: "observed",
      description: `platformToken GET /api/appointments -> ${appts.status()} ${apptsBody}`,
    });
    // Observed on the mt world (2026-09-07): HTTP 403, empty body — a tenant-less PLATFORM_ADMIN
    // principal cannot satisfy the tenant-scoped `/api/appointments` controller. `tokenA` →
    // `/api/platform/tenants` is likewise 403. No leak (a 200 with rows here would be the finding).
    expect(
      [400, 401, 403],
      `platformToken GET /api/appointments -> ${appts.status()}: ${apptsBody}`,
    ).toContain(appts.status());
  });

  // Scenario 6 -----------------------------------------------------------------------------------
  test("AC: forgot-password works for a non-oldest tenant's user", async ({ request }) => {
    const forgot = (email: string) =>
      request.post(`${API_BASE}/api/auth/forgot-password`, { data: { email } });

    // T-B (created after T-A) admin email is unique to exactly one tenant → AuthService issues a
    // reset token. DEVIATION from the brief's "200": the endpoint returns 204 (ResponseEntity<Void>,
    // silent-success anti-enumeration). Trusting the verified facts.
    const tb = await forgot(world.tenantB.adminEmail);
    expect(tb.status()).toBe(204);

    // Anti-enumeration: an email that exists nowhere ALSO returns 204 — so 204 alone is weak.
    const nobody = await forgot(`nobody-${Date.now()}@e2e.local`);
    expect(nobody.status()).toBe(204);

    // An ambiguous email (in A AND B) resolves to no single tenant → also silent 204, no token.
    const ambiguous = await forgot(world.sharedAmbiguousEmail);
    expect(ambiguous.status()).toBe(204);

    // The raw self-service reset token is NOT exposed by any endpoint (unlike the platform-admin
    // resend-invitation path), so we cannot inspect the PasswordResetToken row directly. Instead
    // assert the property that matters: issuing a reset token must NOT disable the account —
    // T-B's admin still logs in with the ORIGINAL password afterwards.
    const stillWorks = await mtLoginToken(request, world.tenantB);
    expect(Number(decodeJwtPayload(stillWorks).tid)).toBe(world.tenantB.id);
  });
});
