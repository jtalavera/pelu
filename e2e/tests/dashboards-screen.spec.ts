import { expect, test } from "@playwright/test";
import { loginAsDemo } from "../fixtures/auth";
import { openSummaryMore } from "../fixtures/ui";

/**
 * "Dashboards" screen — the revenue-trend, top-services, payment-method-mix,
 * appointments-by-day-of-week and tips-by-professional charts moved off the main dashboard
 * (`/app`) onto their own screen (`/app/dashboards`), reached via a "Dashboards" nav item placed
 * right below "Calendar" in the sidebar.
 */
test.describe("Summary screen (ex Dashboards)", () => {
  test("the Summary nav item sits right below Calendar and opens the charts screen", async ({
    page,
  }) => {
    await loginAsDemo(page);

    const calendarLink = page.getByRole("link", { name: "Calendar" });
    const summaryLink = page.getByRole("link", { name: "Summary" });
    await expect(calendarLink).toBeVisible();
    await expect(summaryLink).toBeVisible();

    const [calendarBox, summaryBox] = await Promise.all([
      calendarLink.boundingBox(),
      summaryLink.boundingBox(),
    ]);
    expect(calendarBox).toBeTruthy();
    expect(summaryBox).toBeTruthy();
    // "Right below" — same column, next item down.
    expect(summaryBox!.y).toBeGreaterThan(calendarBox!.y);

    await summaryLink.click();
    await expect(page).toHaveURL(/\/app\/dashboards$/);
    await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible();

    // Redesign: period selector, headline figures and ONE main chart; the rest is folded.
    for (const days of [7, 30, 90]) {
      await expect(page.getByTestId(`summary-period-${days}`)).toBeVisible();
    }
    await expect(page.getByTestId("summary-kpis")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("summary-revenue-card")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("summary-more")).toHaveCount(0);

    await openSummaryMore(page);
    await expect(page.getByTestId("summary-top-services").or(page.getByTestId("summary-more-empty"))).toBeVisible();
    await expect(page.getByTestId("summary-weekday-bars").or(page.getByTestId("summary-more-empty"))).toBeVisible();
  });
});
