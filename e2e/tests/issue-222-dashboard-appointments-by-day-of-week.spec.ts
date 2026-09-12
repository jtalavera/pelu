import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  API_BASE,
  apiGetJson,
  authHeaders,
  createAppointmentApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
  tomorrowLocalIso,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

/**
 * Issue #222 · "Dashboard: gráfico de turnos por día de semana" — bar chart of appointment counts
 * by day of week (business timezone), backed by `DashboardResponse.appointmentsByDayOfWeek` (see
 * `DashboardService.buildAppointmentsByDayOfWeek`), same trailing 30-day window as the sibling
 * issue #219-#221 charts. Counts only `PENDING`/`CONFIRMED`/`IN_PROGRESS`/`COMPLETED` appointments
 * — same criterion as `countDistinctClientsWithAppointmentsBetween` (used for `clientsThisMonth`),
 * excluding `CANCELLED`/`NO_SHOW`.
 *
 * `AppointmentService.create` rejects a `startAt` in the past, so each appointment below is
 * created for tomorrow via the real `POST /api/appointments` and then backdated + completed
 * through the e2e-only `POST /api/admin/appointment-test-support/{id}/backdate-and-complete/{daysAgo}`
 * endpoint (gated the same way as every other `*-test-support` endpoint — never reachable outside
 * the `e2e` Spring profile), same technique as issue #216's inactive-clients spec. That endpoint
 * sets the new `startAt` to "now minus `daysAgo` days" — three *consecutive* days ago (1, 2, 3) are
 * always three distinct calendar days, hence three distinct days of week, regardless of which real
 * weekday the suite happens to run on.
 *
 * The dashboard aggregates *all* of the shared demo tenant's appointments in the window, and specs
 * across the whole e2e suite run with `workers: 1` (see `playwright.config.ts`) — i.e. never
 * concurrently — so a before/after snapshot of `GET /api/dashboard` isolates exactly what this
 * test seeded from anything other specs may have left behind, same pattern as the issue #221
 * payment-method-mix spec.
 */
test.describe.configure({ mode: "serial" });

type AppointmentsByDayOfWeekRow = { dayOfWeek: string; count: number | string };

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

async function fetchAppointmentsByDayOfWeek(
  request: APIRequestContext,
  token: string,
): Promise<Map<string, number>> {
  const json = await apiGetJson<{ appointmentsByDayOfWeek: AppointmentsByDayOfWeekRow[] }>(
    request,
    token,
    "/api/dashboard",
  );
  const map = new Map<string, number>();
  for (const key of DAY_KEYS) map.set(key, 0);
  for (const row of json.appointmentsByDayOfWeek ?? []) {
    map.set(row.dayOfWeek, Number(row.count) || 0);
  }
  return map;
}

async function backdateAndComplete(
  request: APIRequestContext,
  token: string,
  appointmentId: number,
  daysAgo: number,
): Promise<void> {
  const res = await request.post(
    `${API_BASE}/api/admin/appointment-test-support/${appointmentId}/backdate-and-complete/${daysAgo}`,
    { headers: authHeaders(token) },
  );
  expect(res.ok(), await res.text()).toBeTruthy();
}

/** Short English weekday key (business timezone) for "now minus daysAgo days" — matches the
 * backend's `Instant.now().minus(daysAgo, DAYS)` in `AppointmentTestSupportController`, and the
 * chart's `femme.calendar.days.*` short labels (rendered in English for the demo tenant's default
 * locale). */
function expectedDayLabel(daysAgo: number): string {
  const at = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "America/Asuncion" }).format(
    at,
  );
}

test.describe("Issue #222 · Dashboard appointments by day of week chart", () => {
  test("renders the chart with the correct incremental counts across three distinct days", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const token = await loginAsDemoApi(request);

    const before = await fetchAppointmentsByDayOfWeek(request, token);

    const client = await seedClient(request, token, `E2E222 DayOfWeek ${Date.now()}`);

    // Three appointments, three distinct (consecutive) days ago — always three distinct days of
    // week. Each uses its own professional/service so none of the (initially same-tomorrow-slot)
    // creations can collide on the overlap check.
    const daysAgoList = [1, 2, 3];
    for (const daysAgo of daysAgoList) {
      const seed = await seedCategoryServiceProfessional(request, token);
      const appt = await createAppointmentApi(request, token, {
        clientId: client.id,
        professionalId: seed.professionalId,
        serviceId: seed.serviceId,
        startAt: tomorrowLocalIso(10, 0),
      });
      await backdateAndComplete(request, token, appt.id, daysAgo);
    }

    const after = await fetchAppointmentsByDayOfWeek(request, token);

    // "Correct amounts": the total increase equals exactly 3 (one per seeded appointment), spread
    // across exactly 3 distinct day-of-week buckets (never merged into fewer, never leaking into
    // more) — robust against whatever other specs may have already contributed to other buckets.
    let totalDelta = 0;
    let changedBuckets = 0;
    for (const key of DAY_KEYS) {
      const delta = (after.get(key) ?? 0) - (before.get(key) ?? 0);
      expect(delta, `unexpected negative delta for "${key}"`).toBeGreaterThanOrEqual(0);
      totalDelta += delta;
      if (delta > 0) changedBuckets += 1;
    }
    expect(totalDelta).toBe(3);
    expect(changedBuckets).toBe(3);

    await loginAsDemo(page);

    const chart = page.getByTestId("dashboard-appointments-by-day-of-week");
    await expect(chart).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Appointments by day of week", { exact: true })).toBeVisible();

    // Not the empty state, given the appointments seeded above.
    await expect(page.getByTestId("dashboard-appointments-by-day-of-week-empty")).toHaveCount(0);

    // recharts renders a real <svg> once ResponsiveContainer measures a non-zero size.
    await expect(chart.locator("svg").first()).toBeVisible({ timeout: 20_000 });

    // All 7 short day-of-week labels are always rendered (Monday first, zero-filled days included).
    const tickLabels = chart.locator(
      ".recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-label, .recharts-xAxis .recharts-cartesian-axis-tick-value",
    );
    await expect(tickLabels.first()).toBeVisible({ timeout: 20_000 });
    const tickTexts = await tickLabels.allTextContents();
    for (const short of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
      expect(tickTexts, `expected an axis tick for "${short}"`).toContain(short);
    }

    // The three specific days we backdated to are among the rendered ticks (sanity check that the
    // chart's label source (femme.calendar.days.*) matches the day-key mapping this test computed
    // independently).
    for (const daysAgo of daysAgoList) {
      expect(tickTexts).toContain(expectedDayLabel(daysAgo));
    }
  });

  // Note: this asserts the chart *card itself* fits the 400px viewport, not whole-document
  // scrollWidth — same rationale as the analogous sibling chart tests (issues #219-#221): the app
  // has a pre-existing, unrelated horizontal-overflow source on every page (an off-canvas sidebar),
  // reproducible on pages with no chart at all.
  test("mobile viewport (~400px): the chart card itself fits the viewport width", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const client = await seedClient(request, token, `E2E222 Mobile ${Date.now()}`);
    const seed = await seedCategoryServiceProfessional(request, token);
    const appt = await createAppointmentApi(request, token, {
      clientId: client.id,
      professionalId: seed.professionalId,
      serviceId: seed.serviceId,
      startAt: tomorrowLocalIso(10, 0),
    });
    await backdateAndComplete(request, token, appt.id, 1);

    await page.setViewportSize({ width: 400, height: 800 });
    await loginAsDemo(page);

    const chart = page.getByTestId("dashboard-appointments-by-day-of-week");
    await expect(chart).toBeVisible({ timeout: 20_000 });
    await expect(chart.locator("svg").first()).toBeVisible({ timeout: 20_000 });

    const box = await chart.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(400 + 1);
  });
});
