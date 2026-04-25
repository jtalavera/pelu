import { expect, type Page } from "@playwright/test";

/** Seeded by `FemmeDataInitializer` for non-`test` profiles (including `e2e`). */
export const DEMO_EMAIL = "admin@demo.com";
export const DEMO_PASSWORD = "Demo123!";

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
}

export async function loginAsDemo(page: Page) {
  // Mark all guided tours as "seen" so useTour's auto-start timer never fires
  // and the Joyride overlay (z-index 10000) never blocks test interactions.
  await page.addInitScript(markToursSeenScript);
  await page.goto("/login");
  await page.getByLabel("Email").fill(DEMO_EMAIL);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app/, { timeout: 15_000 });
  await expect(page.getByText("Appointments today", { exact: true }).first()).toBeVisible({
    timeout: 15_000,
  });
}

export async function loginAs(page: Page, email: string, password: string) {
  await page.addInitScript(markToursSeenScript);
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app/, { timeout: 15_000 });
}

