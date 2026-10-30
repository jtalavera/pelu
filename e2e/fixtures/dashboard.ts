import { expect, type Page } from "@playwright/test";

/** Inicio redesign: "Más del día" sections are collapsed until the user opens them. */
export type DashboardMoreSection = "records" | "occupancy" | "birthdays" | "inactive";

export async function openDashboardMore(page: Page, section: DashboardMoreSection): Promise<void> {
  const toggle = page.getByTestId(`dashboard-more-${section}`);
  await expect(toggle).toBeVisible({ timeout: 20_000 });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}
