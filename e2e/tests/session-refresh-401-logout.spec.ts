/**
 * Hotfix: a 401 from POST /api/auth/refresh must stop the 5-minute polling
 * loop and log the user out, instead of retrying forever.
 *
 * Background: useSessionRefresh polls /api/auth/refresh every 5 minutes to
 * keep the JWT alive. If that call ever returns a 401 (dead/revoked token),
 * the hook used to silently ignore it and keep polling forever — a stale
 * tab left open would hammer the backend with 401s indefinitely, repeatedly
 * waking a scaled-to-zero prod instance from a cold start.
 *
 * Uses Playwright's clock API (`page.clock`) to simulate the passage of
 * time without real waits.
 */

import { test, expect } from "@playwright/test";
import { loginAsDemo } from "../fixtures/auth";

test.describe("session-refresh 401 stops the retry loop", () => {
  test("redirects to login with a session-expired message and stops retrying after a 401", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    await page.clock.install();
    await loginAsDemo(page);

    let refreshCalls = 0;
    await page.route("**/api/auth/refresh", async (route) => {
      refreshCalls++;
      await route.fulfill({ status: 401, contentType: "application/json", body: "{}" });
    });

    await page.clock.runFor("05:00");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("alert").filter({ hasText: /session expired/i })).toBeVisible();

    const callsAtLogout = refreshCalls;
    expect(callsAtLogout, "the 401 refresh should have fired exactly once").toBe(1);

    await page.clock.runFor("15:00");
    expect(refreshCalls, "refresh must not keep retrying every 5 minutes after a 401").toBe(callsAtLogout);
  });

  test("no session-expired message on a normal, unauthenticated login visit", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("alert").filter({ hasText: /session expired/i })).toHaveCount(0);
  });
});
