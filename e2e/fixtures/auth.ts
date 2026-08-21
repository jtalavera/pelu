import { expect, type Page } from "@playwright/test";

/** Seeded by `FemmeDataInitializer` for non-`test` profiles (including `e2e`). */
export const DEMO_EMAIL = "isabelzymanscki@gmail.com";
export const DEMO_PASSWORD = "Demo123!";

/**
 * HU-34: a tenant-independent PLATFORM_ADMIN used by HU-35's login-routing tests. Bootstrapped by
 * `PlatformAdminBootstrap` (HU-57) on every boot with zero PLATFORM_ADMIN users — see
 * application-e2e.properties' app.femme.platform-admin.* for these exact credentials.
 */
export const PLATFORM_ADMIN_EMAIL = "platform-admin@pelu";
export const PLATFORM_ADMIN_PASSWORD = ".The.Platform@admin.2026";

/**
 * Injected before every page navigation to mark all guided tours as "seen".
 * This prevents the Joyride auto-start (700 ms setTimeout in useTour) from
 * covering the page with its overlay (z-index 10000) and blocking test interactions.
 */
function markToursSeenScript() {
  const PREFIX = "femme.tour.seen.";
  const keys = [
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
  ];
  for (const k of keys) {
    localStorage.setItem(PREFIX + k, "true");
  }
  /** Keep UI strings aligned with assertions (navigator may be es-* by default). */
  localStorage.setItem("cursor_poc.i18n.language", "en");
}

export async function loginAsDemo(page: Page) {
  // Mark all guided tours as "seen" so useTour's auto-start timer never fires
  // and the Joyride overlay (z-index 10000) never blocks test interactions.
  await page.addInitScript(markToursSeenScript);
  await page.goto("/login");
  await page.getByLabel("Email").fill(DEMO_EMAIL);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  const loginPromise = page.waitForResponse((r) => {
    try {
      const u = new URL(r.url());
      return u.pathname.endsWith("/api/auth/login") && r.request().method() === "POST";
    } catch {
      return false;
    }
  });
  await page.getByRole("button", { name: "Sign in" }).click();
  const loginResp = await loginPromise;
  expect(loginResp.ok(), `login failed (${loginResp.status()}): ${loginResp.statusText()}`).toBeTruthy();
  await expect(page).toHaveURL(/\/app/, { timeout: 25_000 });
  await expect(page.getByText("Appointments today", { exact: true }).first()).toBeVisible({
    timeout: 20_000,
  });
}

export async function loginAs(page: Page, email: string, password: string) {
  await page.addInitScript(markToursSeenScript);
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  const loginPromise = page.waitForResponse((r) => {
    try {
      const u = new URL(r.url());
      return u.pathname.endsWith("/api/auth/login") && r.request().method() === "POST";
    } catch {
      return false;
    }
  });
  await page.getByRole("button", { name: "Sign in" }).click();
  const loginResp = await loginPromise;
  expect(loginResp.ok(), `login failed (${loginResp.status()}): ${loginResp.statusText()}`).toBeTruthy();
  await expect(page).toHaveURL(/\/app/, { timeout: 25_000 });
}

/**
 * HU-35 AC-2: logs in through the single, shared login screen and expects the Platform Admin
 * routing destination (`/platform`), not the tenant business panel (`/app`).
 */
export async function loginAsPlatformAdmin(page: Page) {
  await page.addInitScript(markToursSeenScript);
  await page.goto("/login");
  await page.getByLabel("Email").fill(PLATFORM_ADMIN_EMAIL);
  await page.getByLabel("Password").fill(PLATFORM_ADMIN_PASSWORD);
  const loginPromise = page.waitForResponse((r) => {
    try {
      const u = new URL(r.url());
      return u.pathname.endsWith("/api/auth/login") && r.request().method() === "POST";
    } catch {
      return false;
    }
  });
  await page.getByRole("button", { name: "Sign in" }).click();
  const loginResp = await loginPromise;
  expect(loginResp.ok(), `login failed (${loginResp.status()}): ${loginResp.statusText()}`).toBeTruthy();
  await expect(page).toHaveURL(/\/platform/, { timeout: 25_000 });
}

