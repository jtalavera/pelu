import { expect, test } from "@playwright/test";
import {
  apiPostJson,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

/**
 * Issue #220 · "Dashboard: gráfico de servicios más vendidos" — horizontal bar chart of the top
 * services by invoiced revenue, backed by `DashboardResponse.topServices` (see
 * `DashboardService.buildTopServices`, same trailing 30-day window/filters as the issue #219
 * revenue-trend chart: `ISSUED` invoices with a non-REJECTED SIFEN outcome).
 *
 * Revenue amounts here (millions of Gs.) are deliberately far larger than the amounts other e2e
 * specs seed for the shared demo tenant (tens/hundreds of thousands) — the dashboard aggregates
 * *all* of the tenant's invoices in the window, and this suite's specs share one backend/H2
 * instance for the whole run, so these three services must clearly outrank anything another spec
 * could have seeded to keep the top-3 order assertion below deterministic.
 */
test.describe.configure({ mode: "serial" });

async function seedInvoiceForService(
  request: import("@playwright/test").APIRequestContext,
  token: string,
  seed: { serviceId: number; serviceFullName: string },
  clientId: number,
  clientFullName: string,
  amount: number,
): Promise<void> {
  await apiPostJson(request, token, "/api/invoices", {
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
}

test.describe("Issue #220 · Dashboard top services chart", () => {
  test("renders the top-services chart with the highest-revenue service first", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);

    const suffix = Date.now();
    const serviceA = await seedCategoryServiceProfessional(request, token);
    const serviceB = await seedCategoryServiceProfessional(request, token);
    const serviceC = await seedCategoryServiceProfessional(request, token);
    // A RUC avoids SIFEN_CLIENT_IDENTIFICATION_REQUIRED (invoices at/above Gs. 7,000,000 require
    // client identification) — kept below that threshold anyway, but a real RUC removes any doubt.
    const client = await seedClient(
      request,
      token,
      `E2E220 TopServices ${suffix}`,
      undefined,
      "80000005-6",
    );

    // Three distinct services, three distinct (large, easily-distinguishable) revenue totals —
    // well above what other e2e specs seed (tens/hundreds of thousands), but under the
    // Gs. 7,000,000 SIFEN client-identification threshold.
    await seedInvoiceForService(
      request,
      token,
      serviceA,
      client.id,
      client.fullName,
      2_900_000,
    );
    await seedInvoiceForService(
      request,
      token,
      serviceB,
      client.id,
      client.fullName,
      1_900_000,
    );
    await seedInvoiceForService(
      request,
      token,
      serviceC,
      client.id,
      client.fullName,
      900_000,
    );

    await loginAsDemo(page);

    const chart = page.getByTestId("dashboard-top-services");
    await expect(chart).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Top services", { exact: true })).toBeVisible();

    // Not the empty state, given the invoices seeded above.
    await expect(page.getByTestId("dashboard-top-services-empty")).toHaveCount(0);

    // recharts renders a real <svg> once ResponsiveContainer measures a non-zero size.
    await expect(chart.locator("svg").first()).toBeVisible({ timeout: 20_000 });

    // X-axis ticks are money labels — must use the dot-thousands / no-decimals Gs. format.
    await expect(chart.getByText(/^Gs\. \d{1,3}(\.\d{3})*$/).first()).toBeVisible();

    // All three seeded services show up as Y-axis category tick labels. Recharts splits a long
    // category label across multiple <tspan> lines, dropping the whitespace between words in the
    // flattened DOM text (e.g. "E2E Svc 123" renders as textContent "E2E Svc123") — so compare
    // each tick's full textContent, whitespace-stripped, by exact equality (not a substring/regex
    // guess) against the same whitespace-stripped expected name.
    const normalize = (s: string) => s.replace(/\s+/g, "");
    const tickLabels = chart.locator(
      ".recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-label",
    );
    await expect(tickLabels.first()).toBeVisible({ timeout: 20_000 });
    const tickTexts = await tickLabels.allTextContents();
    const normalizedTexts = tickTexts.map(normalize);

    const idxA = normalizedTexts.indexOf(normalize(serviceA.serviceFullName));
    const idxB = normalizedTexts.indexOf(normalize(serviceB.serviceFullName));
    const idxC = normalizedTexts.indexOf(normalize(serviceC.serviceFullName));
    expect(idxA, `expected a tick label for "${serviceA.serviceFullName}"`).toBeGreaterThanOrEqual(
      0,
    );
    expect(idxB, `expected a tick label for "${serviceB.serviceFullName}"`).toBeGreaterThanOrEqual(
      0,
    );
    expect(idxC, `expected a tick label for "${serviceC.serviceFullName}"`).toBeGreaterThanOrEqual(
      0,
    );

    // ...ordered top-to-bottom by revenue descending (A=2.9M > B=1.9M > C=0.9M).
    const [boxA, boxB, boxC] = await Promise.all([
      tickLabels.nth(idxA).boundingBox(),
      tickLabels.nth(idxB).boundingBox(),
      tickLabels.nth(idxC).boundingBox(),
    ]);
    expect(boxA).toBeTruthy();
    expect(boxB).toBeTruthy();
    expect(boxC).toBeTruthy();
    expect(boxA!.y).toBeLessThan(boxB!.y);
    expect(boxB!.y).toBeLessThan(boxC!.y);
  });

  // Note: this asserts the chart *card itself* fits the 400px viewport, not whole-document
  // scrollWidth — same rationale as the analogous revenue-trend chart test (issue #219): the app
  // has a pre-existing, unrelated horizontal-overflow source on every page (an off-canvas
  // sidebar), reproducible on pages with no chart at all.
  test("mobile viewport (~400px): the chart card itself fits the viewport width", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E220 Mobile ${Date.now()}`);
    await seedInvoiceForService(request, token, seed, client.id, client.fullName, 1_500_000);

    await page.setViewportSize({ width: 400, height: 800 });
    await loginAsDemo(page);

    const chart = page.getByTestId("dashboard-top-services");
    await expect(chart).toBeVisible({ timeout: 20_000 });
    await expect(chart.locator("svg").first()).toBeVisible({ timeout: 20_000 });

    const box = await chart.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(400 + 1);
  });
});
