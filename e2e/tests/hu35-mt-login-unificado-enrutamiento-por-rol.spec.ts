import { expect, test } from "@playwright/test";
import { loginAsDemo, loginAsPlatformAdmin } from "../fixtures/auth";

// HU-35 · Login unificado con enrutamiento por rol
// requirements/multi-tenant/HU-35-login-unificado-enrutamiento-por-rol.md
//
// Note on filename: an unrelated legacy story (SIFEN invoice PDF) already occupies the
// "hu-35-*.spec.ts" slug from the old MVP numbering (hu-35-factura-pdf.spec.ts) — this file uses
// "hu35-mt-*" to avoid colliding with it while staying obviously findable.

test.describe("HU-35 · Login unificado con enrutamiento por rol", () => {
  // AC-1 + AC-3: a single login screen for every role, with no manual "access type" selector —
  // only email + password + submit are present, regardless of who ends up logging in.
  test("AC1+AC3: the login screen has no role/access-type selector", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    // No role/"access type" control of any kind on the form.
    await expect(page.locator("select")).toHaveCount(0);
    await expect(page.getByRole("radiogroup")).toHaveCount(0);
  });

  // AC-2: a Platform Admin login lands on /platform, using the very same /login screen (no
  // separate platform-admin URL exists — there's only one "/login" route in the app).
  test("AC2: Platform Admin login redirects to /platform", async ({ page }) => {
    await loginAsPlatformAdmin(page);
    await expect(page).toHaveURL(/\/platform$/);
    await expect(page.getByRole("heading", { name: "Platform Admin" })).toBeVisible();
  });

  // AC-2 (regression): a tenant admin still lands on the tenant business panel, unchanged.
  test("AC2: tenant admin login still redirects to the tenant panel (/app)", async ({ page }) => {
    await loginAsDemo(page);
    await expect(page).toHaveURL(/\/app/);
  });

  // AC-4: a non-Platform-Admin (tenant admin) who navigates straight to /platform by URL is
  // redirected out — never sees the platform area.
  test("AC4: a tenant admin hitting /platform directly by URL is redirected out", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/platform");
    await expect(page).toHaveURL(/\/app/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Platform Admin" })).toHaveCount(0);
  });

  // AC-4: an unauthenticated visitor hitting /platform directly is sent to the single login
  // screen (same behaviour as any other protected route).
  test("AC4: an unauthenticated visit to /platform redirects to /login", async ({ page }) => {
    await page.goto("/platform");
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  });

  // AC-5: the same inactivity-expiration mechanism (HU MVP PRD) applies to a Platform Admin
  // session — after 1h of no genuine DOM interaction, they're logged out to /login, exactly like
  // a tenant user (see issue-115-logout-automatico.spec.ts for the equivalent tenant-side test).
  test("AC5: Platform Admin session expires after 1h idle, same as tenant sessions", async ({ page }) => {
    test.setTimeout(60_000);

    await page.clock.install();
    await loginAsPlatformAdmin(page);

    await page.clock.runFor("59:59");
    await expect(page).toHaveURL(/\/platform/);

    await page.clock.runFor("00:02");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("alert").filter({ hasText: /session expired/i })).toBeVisible();
  });
});
