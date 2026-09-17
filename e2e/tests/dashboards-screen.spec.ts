import { expect, test } from "@playwright/test";
import { loginAsDemo } from "../fixtures/auth";

/**
 * "Dashboards" screen — the revenue-trend, top-services and payment-method-mix charts moved off
 * the main dashboard (`/app`) onto their own screen (`/app/dashboards`), reached via a
 * "Dashboards" nav item placed right below "Calendar" in the sidebar.
 */
test.describe("Dashboards screen", () => {
  test("the Dashboards nav item sits right below Calendar and opens the charts screen", async ({
    page,
  }) => {
    await loginAsDemo(page);

    const calendarLink = page.getByRole("link", { name: "Calendar" });
    const dashboardsLink = page.getByRole("link", { name: "Dashboards" });
    await expect(calendarLink).toBeVisible();
    await expect(dashboardsLink).toBeVisible();

    const [calendarBox, dashboardsBox] = await Promise.all([
      calendarLink.boundingBox(),
      dashboardsLink.boundingBox(),
    ]);
    expect(calendarBox).toBeTruthy();
    expect(dashboardsBox).toBeTruthy();
    // "Right below" — same column, next item down.
    expect(dashboardsBox!.y).toBeGreaterThan(calendarBox!.y);

    await dashboardsLink.click();
    await expect(page).toHaveURL(/\/app\/dashboards$/);
    await expect(page.getByText("Dashboards", { exact: true }).first()).toBeVisible();

    await expect(page.getByTestId("dashboard-revenue-trend")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("dashboard-top-services")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("dashboard-payment-method-mix")).toBeVisible({
      timeout: 20_000,
    });
  });

  test("the main dashboard no longer renders the revenue-trend, top-services or payment-method-mix charts", async ({
    page,
  }) => {
    await loginAsDemo(page);

    await expect(page.getByTestId("dashboard-revenue-trend")).toHaveCount(0);
    await expect(page.getByTestId("dashboard-top-services")).toHaveCount(0);
    await expect(page.getByTestId("dashboard-payment-method-mix")).toHaveCount(0);
  });
});
