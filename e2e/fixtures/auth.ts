import { expect, type Page } from "@playwright/test";

/** Seeded by `FemmeDataInitializer` for non-`test` profiles (including `e2e`). */
export const DEMO_EMAIL = "admin@demo.com";
export const DEMO_PASSWORD = "Demo123!";

export async function loginAsDemo(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(DEMO_EMAIL);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app/);
  await expect(page.getByText("Appointments today", { exact: true }).first()).toBeVisible();
}

export async function loginAs(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app/);
}
