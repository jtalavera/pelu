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

    // Redesign ("Resumen"): one "Invoicing" bar chart — total of the period, a bar per day, the
    // best day highlighted — instead of the recharts area chart with its 7-day-average line.
    const chart = page.getByTestId("summary-revenue-chart");
    await expect(chart).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("summary-revenue-empty")).toHaveCount(0);

    // The headline figure sums the 3 seeded invoices (at least: other specs add their own).
    const revenue = page.getByTestId("summary-kpi-revenue");
    await expect(revenue).toHaveText(/^Gs\. \d{1,3}(\.\d{3})*$/);

    // A bar per plotted day; each bar's aria-label carries "<range>: Gs. <amount>" (dot thousands).
    const bars = page.locator('[data-testid^="summary-bar-2"]');
    await expect(bars.first()).toBeVisible();
    await expect(bars.filter({ has: page.locator("span") }).first()).toHaveAttribute(
      "aria-label",
      /Gs\. \d{1,3}(\.\d{3})*$/,
    );
    // The tapped day is described under the chart (the best day by default).
    await expect(page.getByTestId("summary-bar-tip")).toContainText(/Gs\. \d{1,3}(\.\d{3})*/);

    // Backend: the trend still carries the 6 look-back days so the average starts on day 1.
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
    expect(dashboard.revenueTrend.length).toBe(30);
    // One bar per plotted day (the chart groups by week only for the 90-day period).
    await expect(bars).toHaveCount(dashboard.revenueTrend.length);
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

    const chart = page.getByTestId("summary-revenue-card");
    await expect(chart).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("summary-revenue-chart")).toBeVisible({ timeout: 20_000 });

    const box = await chart.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(400 + 1);
  });
});
