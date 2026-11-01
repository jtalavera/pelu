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
import { openSummaryMore } from "../fixtures/ui";

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
    // Issue #220 follow-up "Dashboards": the top-services chart moved off the main dashboard onto
    // its own screen, reached via the "Dashboards" nav item.
    await page.goto("/app/dashboards");

    // Redesign ("Resumen"): "Top services" is a ranked list inside the folded detail block.
    await openSummaryMore(page);
    const chart = page.getByTestId("summary-top-services");
    await expect(chart).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("summary-more-empty")).toHaveCount(0);

    // Every seeded service is listed with its revenue in the dot-thousands / no-decimals Gs. format,
    // ordered by revenue descending (A=2.9M > B=1.9M > C=0.9M).
    const items = chart.getByRole("listitem");
    const texts = (await items.allTextContents()).map((t) => t.replace(/\s+/g, " "));
    const idxA = texts.findIndex((t) => t.includes(serviceA.serviceFullName));
    const idxB = texts.findIndex((t) => t.includes(serviceB.serviceFullName));
    const idxC = texts.findIndex((t) => t.includes(serviceC.serviceFullName));
    expect(idxA, `expected "${serviceA.serviceFullName}" in the ranking`).toBeGreaterThanOrEqual(0);
    expect(idxB, `expected "${serviceB.serviceFullName}" in the ranking`).toBeGreaterThanOrEqual(0);
    expect(idxC, `expected "${serviceC.serviceFullName}" in the ranking`).toBeGreaterThanOrEqual(0);
    expect(idxA).toBeLessThan(idxB);
    expect(idxB).toBeLessThan(idxC);
    expect(texts[idxA]).toContain("Gs. 2.900.000");
    expect(texts[idxB]).toContain("Gs. 1.900.000");
    expect(texts[idxC]).toContain("Gs. 900.000");
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
    await page.goto("/app/dashboards");

    await openSummaryMore(page);
    const chart = page.getByTestId("summary-top-services");
    await expect(chart).toBeVisible({ timeout: 20_000 });

    const box = await chart.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(400 + 1);
  });
});
