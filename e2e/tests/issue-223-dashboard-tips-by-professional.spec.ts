import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  API_BASE,
  apiPostJson,
  ensureActiveFiscalStampForInvoices,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { filterPropinasByProfessional, propinasMovements } from "../fixtures/propinas";

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
  test("per-professional tip totals are shown in Propinas (the chart moved off Resumen) in the correct money format", async ({
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

    // Redesign: the "tips by professional" chart was removed from Resumen on purpose — the same
    // figures live in Propinas (per-professional filter, period totals, movement amounts).
    await loginAsDemo(page);
    await page.goto("/app/dashboards");
    await expect(page.getByTestId("dashboard-tips-by-professional")).toHaveCount(0);

    await page.goto("/app/propinas");
    await filterPropinasByProfessional(page, profA.fullName);
    await expect(propinasMovements(page)).toHaveCount(1, { timeout: 15_000 });
    await expect(page.getByTestId("propinas-tips-total")).toHaveText(
      `Gs. ${tipAmountA.toLocaleString("es-PY")}`,
    );
    await expect(propinasMovements(page).first()).toContainText(profA.fullName);

    await filterPropinasByProfessional(page, profB.fullName);
    await expect(propinasMovements(page)).toHaveCount(1, { timeout: 15_000 });
    await expect(page.getByTestId("propinas-tips-total")).toHaveText(
      `Gs. ${tipAmountB.toLocaleString("es-PY")}`,
    );
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
    await page.goto("/app/propinas");

    // The tips figures now live in Propinas: its movements card fits a phone.
    const chart = page.getByTestId("propinas-movements");
    await expect(chart).toBeVisible({ timeout: 20_000 });

    const box = await chart.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(400 + 1);
  });
});
