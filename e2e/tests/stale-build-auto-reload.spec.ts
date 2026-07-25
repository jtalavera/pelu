/**
 * Hotfix: auto-reload stale tabs on new deploy.
 *
 * A browser tab can keep an old JS bundle running in memory indefinitely (e.g. left
 * open over a weekend), including old bugfixes it never picked up. `useVersionCheck`
 * polls `/version.json` (interval + on focus) and reloads immediately on a mismatch.
 *
 * Uses Playwright's clock API to fast-forward the real 5-minute check interval without
 * an actual wait, and route-interception to simulate a deploy landing mid-test.
 */

import { test, expect } from "@playwright/test";
import { loginAsDemo } from "../fixtures/auth";

test.describe("stale build auto-reload", () => {
  test("reloads automatically once /version.json reports a newer build", async ({ page }) => {
    test.setTimeout(60_000);

    // `page.waitForEvent("load")` races unreliably against `clock.runFor` across a real
    // navigation (the reload itself) — a plain listener + poll is robust to that instead.
    let loadCount = 0;
    page.on("load", () => loadCount++);

    await page.clock.install();
    await loginAsDemo(page);
    loadCount = 0; // discount the goto("/login") + post-login navigation load events

    const initialVersion = await page.evaluate(
      () => (window as unknown as { __APP_VERSION__?: string }).__APP_VERSION__,
    );
    expect(initialVersion).toBeTruthy();

    let servedVersion = initialVersion as string;
    await page.route("**/version.json*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ version: servedVersion }),
      });
    });

    await page.clock.runFor("04:59");
    await expect(page).toHaveURL(/\/app/);
    expect(loadCount, "no reload should happen while /version.json still matches").toBe(0);

    servedVersion = `${initialVersion}-new`;
    await page.clock.runFor("00:02");

    await expect.poll(() => loadCount, { timeout: 10_000 }).toBeGreaterThan(0);
    await expect(page).toHaveURL(/\/app/);
  });

  test("also self-heals a tab left open on the (unauthenticated) login page", async ({ page }) => {
    test.setTimeout(60_000);

    let loadCount = 0;
    page.on("load", () => loadCount++);

    await page.clock.install();
    await page.goto("/login");
    loadCount = 0; // discount the goto("/login") load event itself

    const initialVersion = await page.evaluate(
      () => (window as unknown as { __APP_VERSION__?: string }).__APP_VERSION__,
    );
    expect(initialVersion).toBeTruthy();

    await page.route("**/version.json*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ version: `${initialVersion}-new` }),
      });
    });

    await page.clock.runFor("05:01");

    await expect.poll(() => loadCount, { timeout: 10_000 }).toBeGreaterThan(0);
    await expect(page).toHaveURL(/\/login/);
  });
});
