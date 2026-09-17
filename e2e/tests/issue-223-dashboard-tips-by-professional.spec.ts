import { expect, test, type APIRequestContext } from "@playwright/test";
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
 * Issue #223 · "Dashboard: gráfico de propinas por profesional" — horizontal bar chart of tip
 * totals by professional, added to the main Dashboard (`DashboardPage.tsx`). This issue adds *no*
 * new backend aggregation: the chart is fed by calling the already-existing
 * `GET /api/propinas/report` endpoint (`TipsController`/`TipsService`, already used by
 * `PropinasPage.tsx`) with a client-computed date range equivalent to the same trailing 30-day
 * window the sibling dashboard charts (issues #219-#222) share (see `DashboardPage.tsx`'s
 * `tipsWindowRangeIso`).
 * totals by professional. This issue adds *no* new backend aggregation: the chart is fed by
 * calling the already-existing `GET /api/propinas/report` endpoint (`TipsController`/
 * `TipsService`, already used by `PropinasPage.tsx`) with a client-computed date range equivalent
 * to the same trailing 30-day window the sibling dashboard charts (issues #219-#222) share (see
 * `DashboardsPage.tsx`'s `tipsWindowRangeIso`).
 *
 * Issue #220 follow-up "Dashboards": this chart lives on the dedicated `/app/dashboards` screen
 * (reached via the "Dashboards" nav item), not the main dashboard — same as the sibling issue
 * #219-#222 charts — so every assertion below navigates there first.
 *
 * Each seeded professional here is a brand-new entity (unique name per run), so its tip total in
 * the report is exactly what this test seeds — no before/after diffing needed against whatever
 * other e2e specs may have contributed to the shared demo tenant's tips.
 */
test.describe.configure({ mode: "serial" });

type ServiceRecordSeed = { id: number; status: string };

async function seedProfessional(
  request: APIRequestContext,
  token: string,
  fullName: string,
): Promise<{ id: number; fullName: string }> {
  // Names are stored in UPPERCASE (issue #155 AC3) — return what's actually displayed, not the
  // mixed-case string sent above.
  return apiPostJson<{ id: number; fullName: string }>(request, token, "/api/professionals", {
    fullName,
    phone: null,
    email: null,
    photoDataUrl: null,
  });
}

/**
 * Creates an open ficha de servicio with a tip for one professional, then issues an invoice
 * referencing it so the ficha auto-closes — Propinas only reports/accumulates CLOSED-record tips.
 * Same helper as issue #120's Propinas spec.
 */
async function seedClosedTip(
  request: APIRequestContext,
  token: string,
  params: {
    clientId: number;
    serviceId: number;
    professionalId: number;
    unitPrice: number;
    tipAmount: number;
  },
): Promise<{ recordId: number; invoiceId: number }> {
  const record = await apiPostJson<ServiceRecordSeed>(request, token, "/api/service-records", {
    clientId: params.clientId,
    lines: [
      {
        serviceId: params.serviceId,
        professionalId: params.professionalId,
        quantity: 1,
        unitPrice: params.unitPrice,
      },
    ],
    tips: [{ professionalId: params.professionalId, amount: params.tipAmount }],
  });
  const invoice = await apiPostJson<{ id: number }>(request, token, "/api/invoices", {
    clientId: params.clientId,
    clientDisplayName: null,
    clientRucOverride: null,
    discountType: null,
    discountValue: null,
    lines: [
      {
        serviceId: params.serviceId,
        description: "E2E223 service",
        quantity: 1,
        unitPrice: params.unitPrice,
        discountType: null,
        discountValue: null,
      },
    ],
    payments: [{ method: "CASH", amount: params.unitPrice }],
    serviceRecordId: record.id,
    tipsAmount: params.tipAmount,
  });
  return { recordId: record.id, invoiceId: invoice.id };
}

test.describe("Issue #223 · Dashboard tips-by-professional chart", () => {
  test("renders the chart with correct per-professional tip totals in the correct money format", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);

    const suffix = Date.now();
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E223 Tips ${suffix}`);

    const profA = await seedProfessional(request, token, `E2E223 TipsAlpha ${suffix}`);
    const profB = await seedProfessional(request, token, `E2E223 TipsBravo ${suffix}`);

    // Two distinct, easily-distinguishable tip totals for two distinct (brand-new) professionals.
    const tipAmountA = 90_000;
    const tipAmountB = 45_000;
    await seedClosedTip(request, token, {
      clientId: client.id,
      serviceId: seed.serviceId,
      professionalId: profA.id,
      unitPrice: 200_000,
      tipAmount: tipAmountA,
    });
    await seedClosedTip(request, token, {
      clientId: client.id,
      serviceId: seed.serviceId,
      professionalId: profB.id,
      unitPrice: 150_000,
      tipAmount: tipAmountB,
    });

    await loginAsDemo(page);
    await page.goto("/app/dashboards");

    const chart = page.getByTestId("dashboard-tips-by-professional");
    await expect(chart).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Tips by professional", { exact: true })).toBeVisible();

    // Not the empty state, given the tips seeded above.
    await expect(page.getByTestId("dashboard-tips-by-professional-empty")).toHaveCount(0);

    // recharts renders a real <svg> once ResponsiveContainer measures a non-zero size.
    await expect(chart.locator("svg").first()).toBeVisible({ timeout: 20_000 });

    // X-axis ticks are money labels — must use the dot-thousands / no-decimals Gs. format (same
    // assertion issue #220's top-services chart makes on its own value axis).
    await expect(chart.getByText(/^Gs\. \d{1,3}(\.\d{3})*$/).first()).toBeVisible();

    // Both seeded professionals show up as Y-axis category tick labels. Recharts splits a long
    // category label across multiple <tspan> lines, dropping the whitespace between words in the
    // flattened DOM text — so compare each tick's full textContent, whitespace-stripped, by exact
    // equality (not a substring/regex guess) against the same whitespace-stripped expected name
    // (same technique as issue #220's top-services spec).
    const normalize = (s: string) => s.replace(/\s+/g, "");
    const tickLabels = chart.locator(
      ".recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-label",
    );
    await expect(tickLabels.first()).toBeVisible({ timeout: 20_000 });
    const tickTexts = await tickLabels.allTextContents();
    const normalizedTexts = tickTexts.map(normalize);

    const idxA = normalizedTexts.indexOf(normalize(profA.fullName));
    const idxB = normalizedTexts.indexOf(normalize(profB.fullName));
    expect(idxA, `expected a tick label for "${profA.fullName}"`).toBeGreaterThanOrEqual(0);
    expect(idxB, `expected a tick label for "${profB.fullName}"`).toBeGreaterThanOrEqual(0);

    // Correct per-professional amounts: hover each professional's bar (same DOM index as its Y-axis
    // tick, since both the bars and the category ticks render in the same data-array order) and
    // assert the tooltip shows exactly the tip total seeded for that professional, in the
    // dot-thousands / no-decimals Gs. format (mirrors issue #221's donut-chart tooltip assertion —
    // this chart's per-bar value, like that chart's per-slice value, is only shown on hover).
    const barRectangles = chart.locator(".recharts-bar-rectangle");
    const tooltipValue = chart.locator(".recharts-tooltip-item-value");

    await barRectangles.nth(idxA).hover();
    await expect(tooltipValue.first()).toBeVisible({ timeout: 5_000 });
    await expect(tooltipValue.first()).toHaveText(`Gs. ${tipAmountA.toLocaleString("es-PY")}`);

    await barRectangles.nth(idxB).hover();
    await expect(tooltipValue.first()).toBeVisible({ timeout: 5_000 });
    await expect(tooltipValue.first()).toHaveText(`Gs. ${tipAmountB.toLocaleString("es-PY")}`);
  });

  // Note: this asserts the chart *card itself* fits the 400px viewport, not whole-document
  // scrollWidth — same rationale as the analogous sibling chart tests (issues #219-#222): the app
  // has a pre-existing, unrelated horizontal-overflow source on every page (an off-canvas sidebar),
  // reproducible on pages with no chart at all.
  test("mobile viewport (~400px): the chart card itself fits the viewport width", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await ensureActiveFiscalStampForInvoices(request, token);
    await ensureCashSessionOpenApi(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E223 Mobile ${Date.now()}`);
    await seedClosedTip(request, token, {
      clientId: client.id,
      serviceId: seed.serviceId,
      professionalId: seed.professionalId,
      unitPrice: 100_000,
      tipAmount: 30_000,
    });

    await page.setViewportSize({ width: 400, height: 800 });
    await loginAsDemo(page);
    await page.goto("/app/dashboards");

    const chart = page.getByTestId("dashboard-tips-by-professional");
    await expect(chart).toBeVisible({ timeout: 20_000 });
    await expect(chart.locator("svg").first()).toBeVisible({ timeout: 20_000 });

    const box = await chart.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(400 + 1);
  });
});
