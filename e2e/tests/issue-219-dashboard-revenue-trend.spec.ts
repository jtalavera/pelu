import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  API_BASE,
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

    const chart = page.getByTestId("dashboard-revenue-trend");
    await expect(chart).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Revenue trend", { exact: true })).toBeVisible();

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

    const chart = page.getByTestId("dashboard-revenue-trend");
    await expect(chart).toBeVisible({ timeout: 20_000 });
    await expect(chart.locator("svg").first()).toBeVisible({ timeout: 20_000 });

    const box = await chart.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(400 + 1);
  });
});
