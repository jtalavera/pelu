/**
 * Issue #115 · Verificar funcionamiento del logout automatico.
 *
 * Acceptance criteria:
 * 1. If the user does not use the UI for 1 hour, the session must expire automatically.
 * 2. When the session expires, the app must redirect to the login page automatically.
 * 3. Automatic requests that periodically refresh data must not keep the session alive
 *    indefinitely.
 * 4. Once redirected to the login page, no automatic requests from the frontend to the
 *    backend must remain in flight.
 *
 * Uses Playwright's clock API (`page.clock`) to simulate the passage of an hour without
 * real waits. The clock is installed before login so every timer created afterwards
 * (idle-logout timeout, session-refresh interval, dashboard poll interval) runs on the
 * faked clock from the start.
 */

import { test, expect } from "@playwright/test";
import { loginAsDemo } from "../fixtures/auth";

test.describe("issue-115 logout automatico", () => {
  test("AC1+AC2: redirects to login with a session-expired message after 1h idle", async ({ page }) => {
    test.setTimeout(60_000);

    await page.clock.install();
    await loginAsDemo(page);

    await page.clock.runFor("59:59");
    await expect(page).toHaveURL(/\/app/);

    await page.clock.runFor("00:02");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("alert").filter({ hasText: /session expired/i })).toBeVisible();
  });

  test("AC3: periodic background requests fire but do not postpone the idle logout", async ({ page }) => {
    test.setTimeout(60_000);

    await page.clock.install();
    await loginAsDemo(page);

    const refreshCalls: string[] = [];
    const dashboardCalls: string[] = [];
    page.on("request", (r) => {
      const url = r.url();
      if (url.includes("/api/auth/refresh")) refreshCalls.push(url);
      if (url.includes("/api/dashboard")) dashboardCalls.push(url);
    });

    await page.clock.runFor("01:00:01");

    expect(refreshCalls.length, "session-refresh polling should have fired during the idle window").toBeGreaterThan(0);
    expect(dashboardCalls.length, "dashboard polling should have fired during the idle window").toBeGreaterThan(0);
    await expect(page).toHaveURL(/\/login/);
  });

  test("AC4: no automatic requests remain once redirected to login", async ({ page }) => {
    test.setTimeout(60_000);

    await page.clock.install();
    await loginAsDemo(page);

    await page.clock.runFor("01:00:01");
    await expect(page).toHaveURL(/\/login/);

    const postRedirectCalls: string[] = [];
    page.on("request", (r) => {
      const url = r.url();
      if (url.includes("/api/auth/refresh") || url.includes("/api/dashboard")) postRedirectCalls.push(url);
    });

    await page.clock.runFor("00:10:00");

    expect(postRedirectCalls, "no polling requests should survive the AppShell unmount").toEqual([]);
  });

  test("regression: genuine activity resets the idle clock", async ({ page }) => {
    test.setTimeout(60_000);

    await page.clock.install();
    await loginAsDemo(page);

    await page.clock.runFor("00:50:00");
    await page.mouse.move(100, 100);

    await page.clock.runFor("00:50:00");
    await expect(page).toHaveURL(/\/app/);

    await page.clock.runFor("00:15:00");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("alert").filter({ hasText: /session expired/i })).toBeVisible();
  });

  test("no session-expired message on a normal, unauthenticated login visit", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("alert").filter({ hasText: /session expired/i })).toHaveCount(0);
  });

  test("regression: a 401 from the refresh endpoint stops the retry loop and logs out", async ({ page }) => {
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
    await page.clock.runFor("15:00");
    expect(refreshCalls, "refresh must not keep retrying every 5 minutes after a 401").toBe(callsAtLogout);
  });
});
