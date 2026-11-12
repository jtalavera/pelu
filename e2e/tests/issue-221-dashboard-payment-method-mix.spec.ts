import { expect, test } from "@playwright/test";
import {
  apiGetJson,
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
 * Issue #221 · "Dashboard: gráfico de mezcla de medios de pago" — donut chart of invoiced revenue
 * by `InvoicePaymentAllocation.method`, backed by `DashboardResponse.paymentMethodMix` (see
 * `DashboardService.buildPaymentMethodMix`), same trailing 30-day window/filters as the issue
 * #219/#220 charts (`ISSUED` invoices with a non-REJECTED SIFEN outcome, joined on
 * `Invoice.issuedAt`).
 *
 * Revenue amounts here (millions of Gs.) are deliberately far larger than the amounts other e2e
 * specs seed for the shared demo tenant — the dashboard aggregates *all* of the tenant's invoices
 * in the window, and this suite's specs share one backend/H2 instance for the whole run. To assert
 * "correct amounts" robustly against that shared-tenant pollution (other specs almost always pay
 * by CASH), the amount assertions below diff a before/after snapshot of `GET /api/dashboard`
 * rather than asserting an absolute total.
 */
test.describe.configure({ mode: "serial" });

type PaymentMethodMixRow = { method: string; amount: string | number };

async function fetchPaymentMethodMix(
  request: import("@playwright/test").APIRequestContext,
  token: string,
): Promise<Map<string, number>> {
  const json = await apiGetJson<{ paymentMethodMix: PaymentMethodMixRow[] }>(
    request,
    token,
    "/api/dashboard",
  );
  const map = new Map<string, number>();
  for (const row of json.paymentMethodMix) {
    map.set(row.method, Number(row.amount) || 0);
  }
  return map;
}

async function seedInvoicePaidWithMethod(
  request: import("@playwright/test").APIRequestContext,
  token: string,
  seed: { serviceId: number; serviceFullName: string },
  clientId: number,
  clientFullName: string,
  amount: number,
  method: string,
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
    payments: [{ method, amount }],
  });
}

test.describe("Issue #221 · Dashboard payment method mix chart", () => {
  test("renders the chart with every seeded payment method and the correct incremental amounts", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);

    const suffix = Date.now();
    const seed = await seedCategoryServiceProfessional(request, token);
    // A RUC avoids SIFEN_CLIENT_IDENTIFICATION_REQUIRED (invoices at/above Gs. 7,000,000 require
    // client identification) — kept below that threshold anyway, but a real RUC removes any doubt.
    // Derived from `suffix` (not the "80000005-6" literal other dashboard specs use) so it never
    // collides with CLIENT_RUC_DUPLICATE when this suite's specs share one backend/H2 instance.
    const client = await seedClient(
      request,
      token,
      `E2E221 PaymentMix ${suffix}`,
      undefined,
      `${suffix}-1`,
    );

    const before = await fetchPaymentMethodMix(request, token);

    // Two distinct, large, easily-distinguishable amounts on two distinct payment methods — well
    // above what other e2e specs seed (tens/hundreds of thousands), but under the Gs. 7,000,000
    // SIFEN client-identification threshold.
    const cashAmount = 2_900_000;
    const transferAmount = 1_900_000;
    await seedInvoicePaidWithMethod(
      request,
      token,
      seed,
      client.id,
      client.fullName,
      cashAmount,
      "CASH",
    );
    await seedInvoicePaidWithMethod(
      request,
      token,
      seed,
      client.id,
      client.fullName,
      transferAmount,
      "TRANSFER",
    );

    const after = await fetchPaymentMethodMix(request, token);

    // "Correct amounts": the increase for each method equals exactly what we just seeded, not just
    // "some" increase — robust against other specs concurrently/previously adding CASH revenue.
    const cashDelta = (after.get("CASH") ?? 0) - (before.get("CASH") ?? 0);
    const transferDelta = (after.get("TRANSFER") ?? 0) - (before.get("TRANSFER") ?? 0);
    expect(cashDelta).toBe(cashAmount);
    expect(transferDelta).toBe(transferAmount);

    await loginAsDemo(page);
    await page.goto("/app/dashboards");

    // Redesign ("Resumen"): one stacked bar plus a legend row per method with its share (%).
    await openSummaryMore(page);
    const chart = page.getByTestId("summary-payment-methods");
    await expect(chart).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("summary-more-empty")).toHaveCount(0);

    const legend = chart.getByRole("listitem");
    const rows = (await legend.allTextContents()).map((t) => t.replace(/\s+/g, " "));
    const cashRow = rows.find((t) => t.includes("Cash"));
    const transferRow = rows.find((t) => t.includes("Transfer"));
    expect(cashRow, "a legend row for Cash").toBeTruthy();
    expect(transferRow, "a legend row for Transfer").toBeTruthy();
    // Each row carries its percentage of the period's total.
    expect(cashRow).toMatch(/\d{1,3}%/);
    expect(transferRow).toMatch(/\d{1,3}%/);
    const total = rows.reduce((sum, t) => sum + Number(/(\d{1,3})%/.exec(t)?.[1] ?? 0), 0);
    expect(Math.abs(total - 100)).toBeLessThanOrEqual(rows.length); // rounding only
  });

  // Note: this asserts the chart *card itself* fits the 400px viewport, not whole-document
  // scrollWidth — same rationale as the analogous revenue-trend/top-services chart tests (issues
  // #219/#220): the app has a pre-existing, unrelated horizontal-overflow source on every page (an
  // off-canvas sidebar), reproducible on pages with no chart at all.
  test("mobile viewport (~400px): the chart card itself fits the viewport width", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E221 Mobile ${Date.now()}`);
    await seedInvoicePaidWithMethod(
      request,
      token,
      seed,
      client.id,
      client.fullName,
      1_500_000,
      "CASH",
    );

    await page.setViewportSize({ width: 400, height: 800 });
    await loginAsDemo(page);
    await page.goto("/app/dashboards");

    await openSummaryMore(page);
    const chart = page.getByTestId("summary-payment-methods");
    await expect(chart).toBeVisible({ timeout: 20_000 });

    const box = await chart.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(400 + 1);
  });
});
