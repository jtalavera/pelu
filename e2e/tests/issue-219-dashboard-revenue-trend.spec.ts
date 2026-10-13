import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  API_BASE,
  apiGetJson,
  apiPostJson,
  authHeaders,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

/**
 * Issue #219 · "Dashboard: fundamentos de gráficos + tendencia de facturación" — revenue-trend
 * area chart backed by `DashboardResponse.revenueTrend`/`revenueTrendDays` (see
 * `DashboardService.buildRevenueTrend`, trailing 30-day window by default).
 *
 * Invoices are issued via the real `POST /api/invoices` (so amounts/status are exactly what a real
 * comprobante produces) then backdated to a specific day via the existing e2e-only `POST
 * /api/admin/sifen-test-support/invoices/{id}/backdate-issued-at/{hoursAgo}` support endpoint
 * (gated behind `femme.data-init.enabled`, same as every other `*-test-support` endpoint — never
 * reachable outside the `e2e` Spring profile) — the real invoice-creation flow always stamps
 * `issuedAt` as "now", and there is no way to backdate it through the public API.
 */
test.describe.configure({ mode: "serial" });

async function backdateIssuedAt(
  request: APIRequestContext,
  token: string,
  invoiceId: number,
  hoursAgo: number,
): Promise<void> {
  const res = await request.post(
    `${API_BASE}/api/admin/sifen-test-support/invoices/${invoiceId}/backdate-issued-at/${hoursAgo}`,
    { headers: authHeaders(token) },
  );
  expect(res.ok(), await res.text()).toBeTruthy();
}

async function seedInvoiceOnDay(
  request: APIRequestContext,
  token: string,
  seed: { serviceId: number; serviceFullName: string },
  clientId: number,
  clientFullName: string,
  amount: number,
  daysAgo: number,
): Promise<void> {
  const inv = await apiPostJson<{ id: number }>(request, token, "/api/invoices", {
    clientId,
    clientDisplayName: clientFullName,
    clientRucOverride: null,
    clientIdentityDocumentOverride: null,
    lines: [
      {
        serviceId: seed.serviceId,
        description: seed.serviceFullName,
        quantity: 1,
        unitPrice: amount,
      },
    ],
    payments: [{ method: "CASH", amount }],
  });
  // +2h padding so the backdated instant stays comfortably inside the target calendar day
  // (business timezone) regardless of the wall-clock time this test happens to run at.
  await backdateIssuedAt(request, token, inv.id, daysAgo * 24 + 2);
}

test.describe("Issue #219 · Dashboard revenue trend", () => {
  test("renders the revenue-trend chart with real invoice data spread across several days", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E219 Trend ${Date.now()}`);

    // Three invoices on three distinct days, all inside the default 30-day trailing window.
    await seedInvoiceOnDay(request, token, seed, client.id, client.fullName, 120_000, 2);
    await seedInvoiceOnDay(request, token, seed, client.id, client.fullName, 300_000, 9);
    await seedInvoiceOnDay(request, token, seed, client.id, client.fullName, 75_000, 21);

    await loginAsDemo(page);
    // Issue #220 follow-up "Dashboards": the revenue-trend chart moved off the main dashboard onto
    // its own screen, reached via the "Dashboards" nav item.
    await page.goto("/app/dashboards");

    const chart = page.getByTestId("dashboard-revenue-trend");
    await expect(chart).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Invoicing", { exact: true })).toBeVisible();

    // Not the empty state, given the invoices seeded above.
    await expect(page.getByTestId("dashboard-revenue-trend-empty")).toHaveCount(0);

    // recharts renders a real <svg> once ResponsiveContainer measures a non-zero size.
    await expect(chart.locator("svg").first()).toBeVisible({ timeout: 20_000 });

    // Y-axis ticks are money labels — must use the dot-thousands / no-decimals Gs. format.
    await expect(chart.getByText(/^Gs\. \d{1,3}(\.\d{3})*$/).first()).toBeVisible();

    // X-axis ticks include the weekday abbreviation (e.g. "Mon 14/09"), so a revenue dip on a
    // Saturday/Sunday reads as an expected weekend, not an unexplained anomaly.
    await expect(chart.getByText(/^[A-Za-z]{3} \d{2}\/\d{2}$/).first()).toBeVisible();

    // The trailing 30-day window always spans several weekends regardless of which days have
    // invoices, so the shaded weekend bands render unconditionally once the chart has data.
    await expect(
      chart.locator('[data-testid="dashboard-revenue-trend-weekend-band"]').first(),
    ).toBeAttached();

    // Trend line: a 7-day moving average overlays the bars, with a legend distinguishing
    // "Invoiced" (bars) from "7-day average" (line). Scoped to the legend specifically — recharts
    // also keeps a (hidden until hover) tooltip entry with the same series names in the DOM,
    // which would otherwise match too and violate strict mode.
    await expect(chart.locator(".recharts-line-curve")).toBeAttached();
    const legend = chart.locator(".recharts-legend-wrapper");
    await expect(legend.getByText("Invoiced", { exact: true })).toBeVisible();
    await expect(legend.getByText("7-day average", { exact: true })).toBeVisible();

    // Colour: the trend is the same measure as the bars, so it stays in the same hue — the line in
    // the full hue (2px) and the daily bars as a recessive tint of it (not a second, rose hue).
    const line = chart.locator(".recharts-line-curve");
    await expect(line).toHaveAttribute("stroke", "var(--color-teal)");
    await expect(line).toHaveAttribute("stroke-width", "2");
    const bar = chart.locator(".recharts-bar-rectangle path").first();
    await expect(bar).toHaveAttribute("fill", "var(--color-teal)");
    await expect(bar).toHaveAttribute("fill-opacity", "0.55");

    // The 7-day average starts on the window's FIRST day: the backend also returns the 6 days
    // before the window (`revenueTrendLookback`, not plotted as bars) so day 1 already has a full
    // week behind it, and the line starts over the first bar instead of one week in.
    const dashboard = await apiGetJson<{
      revenueTrend: Array<{ date: string; invoiced: string | number }>;
      revenueTrendLookback: Array<{ date: string }>;
    }>(request, token, "/api/dashboard");
    expect(dashboard.revenueTrendLookback).toHaveLength(6);
    const dayBefore = (iso: string) => {
      const d = new Date(`${iso}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - 1);
      return d.toISOString().slice(0, 10);
    };
    expect(dashboard.revenueTrendLookback[5].date).toBe(dayBefore(dashboard.revenueTrend[0].date));
    // The line starts over the FIRST plotted day. recharts draws no rectangle for a day with
    // zero invoicing, so that day's x is its bar's centre — or, for a zero day, the "no invoicing"
    // marker the chart draws on it (issue #284).
    const startX = (d: string | null) => Number(/^M\s*([\d.]+)/.exec(d ?? "")?.[1]);
    const lineStartX = startX(await line.getAttribute("d"));
    const first = dashboard.revenueTrend[0];
    let firstDayCenterX: number;
    if (Number(first.invoiced) === 0) {
      const marker = chart.locator(`[data-testid="dashboard-revenue-trend-zero-day"][data-date="${first.date}"]`);
      firstDayCenterX = Number(await marker.getAttribute("cx"));
    } else {
      firstDayCenterX = Number(await bar.getAttribute("x")) + Number(await bar.getAttribute("width")) / 2;
    }
    expect(Math.abs(lineStartX - firstDayCenterX)).toBeLessThanOrEqual(1);
    // Every plotted day is visible: a bar when it has invoicing, a marker when it has none
    // (the lookback days are never drawn).
    const zeroDays = dashboard.revenueTrend.filter((p) => Number(p.invoiced) === 0).length;
    await expect(chart.locator(".recharts-bar-rectangle")).toHaveCount(dashboard.revenueTrend.length - zeroDays);
    await expect(chart.getByTestId("dashboard-revenue-trend-zero-day")).toHaveCount(zeroDays);

    // Direct label: only the line's last point carries a ringed dot with the average's value
    // (never a number on every point).
    const endDot = chart.getByTestId("dashboard-revenue-trend-end-dot");
    await expect(endDot).toHaveCount(1);
    await expect(endDot.locator("text")).toHaveText(/^Gs\. \d{1,3}(\.\d{3})*$/);
    await expect(endDot.locator("circle")).toHaveAttribute("stroke", "var(--color-white)");
  });

  // Note: this asserts the chart *card itself* fits the 400px viewport, not whole-document
  // scrollWidth — the app already has a pre-existing, unrelated horizontal-overflow source (an
  // off-canvas sidebar contributing to document width on every page, dashboard included, before
  // this chart section ever existed — reproduced on /app/clients, which has no chart at all).
  // Asserting on the whole document here would fail on that unrelated, pre-existing issue instead
  // of testing this chart's own responsiveness.
  test("mobile viewport (~400px): the chart card itself fits the viewport width", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E219 Mobile ${Date.now()}`);
    await seedInvoiceOnDay(request, token, seed, client.id, client.fullName, 90_000, 1);

    await page.setViewportSize({ width: 400, height: 800 });
    await loginAsDemo(page);
    await page.goto("/app/dashboards");

    const chart = page.getByTestId("dashboard-revenue-trend");
    await expect(chart).toBeVisible({ timeout: 20_000 });
    await expect(chart.locator("svg").first()).toBeVisible({ timeout: 20_000 });

    const box = await chart.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(400 + 1);
  });
});
