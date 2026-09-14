import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  API_BASE,
  authHeaders,
  createAppointmentApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
  tomorrowLocalIso,
  type SeededSalon,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

/**
 * Issue #216 · "Panel de clientes inactivos" — Dashboard widget listing active clients whose most
 * recent `COMPLETED` appointment is 60+ days old (or who never had one), ordered by days of
 * inactivity descending, capped to the top 20.
 *
 * `AppointmentService.create`/`.update` reject a `startAt` in the past, so a client's "last visit"
 * is seeded by creating a normal future appointment via the real API and then backdating +
 * completing it through the e2e-only
 * `POST /api/admin/appointment-test-support/{id}/backdate-and-complete/{daysAgo}` endpoint (gated
 * the same way as the other `*-test-support` endpoints — never reachable outside the `e2e` Spring
 * profile).
 *
 * Client full names are stored/rendered in UPPERCASE (issue #155 AC3) — all label matching below
 * is case-insensitive to account for that.
 */
test.describe.configure({ mode: "serial" });

function hasLabel(row: string, label: string): boolean {
  return row.toUpperCase().includes(label.toUpperCase());
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

/** Seeds a client with exactly one COMPLETED appointment `daysAgo` days in the past. */
async function seedClientWithCompletedVisit(
  request: APIRequestContext,
  token: string,
  salon: SeededSalon,
  fullName: string,
  phone: string,
  daysAgo: number,
): Promise<{ id: number }> {
  const client = await seedClient(request, token, fullName, phone);
  const appt = await createAppointmentApi(request, token, {
    clientId: client.id,
    professionalId: salon.professionalId,
    serviceId: salon.serviceId,
    startAt: tomorrowLocalIso(10, 0),
  });
  await backdateAndComplete(request, token, appt.id, daysAgo);
  return client;
}

type WidgetRow = { fullName: string; phone: string; inactivity: string };

/** Reads the widget's rows as separate {fullName, phone, inactivity} cells (not raw row text —
 * concatenated cell text with no separator can otherwise merge e.g. a phone number with a
 * following "N days" into one bogus digit run). */
async function widgetRows(page: import("@playwright/test").Page): Promise<WidgetRow[]> {
  await expect(page.getByTestId("dashboard-inactive-clients")).toBeVisible();
  const rowLocators = await page.getByTestId("dashboard-inactive-client-row").all();
  const rows: WidgetRow[] = [];
  for (const row of rowLocators) {
    const cells = await row.locator("td").allTextContents();
    rows.push({ fullName: cells[0] ?? "", phone: cells[1] ?? "", inactivity: cells[2] ?? "" });
  }
  return rows;
}

test.describe("Issue #216 · Panel de clientes inactivos", () => {
  test("AC1/AC2 · cliente inactivo (60+ días) aparece con teléfono y días; cliente reciente no aparece; orden desc", async ({
    page,
    request,
  }) => {
    // Clean slate: the widget's "never visited" candidates always outrank any dated inactivity
    // (see DashboardService#buildInactiveClients's comparator) and it's capped to the top 20 —
    // without a reset, the active clients accumulated by every earlier spec in the full suite (most
    // of which seed a client without ever completing a visit for it) can easily crowd out this
    // test's 250d-inactive client from the visible top 20. POST /api/admin/seed/reset wipes tenant
    // 1's clients/appointments (HU-27) and needs no prior auth — same pattern the AC3 cap test
    // below already uses for the identical reason.
    const resetRes = await request.post(`${API_BASE}/api/admin/seed/reset`);
    expect(resetRes.ok(), await resetRes.text()).toBeTruthy();

    const token = await loginAsDemoApi(request);
    const salon = await seedCategoryServiceProfessional(request, token);
    const suffix = Date.now();

    const veryOldLabel = `E2E216 VeryOld ${suffix}`;
    const oldLabel = `E2E216 Old ${suffix}`;
    const recentLabel = `E2E216 Recent ${suffix}`;

    await seedClientWithCompletedVisit(request, token, salon, veryOldLabel, "0981100001", 250);
    await seedClientWithCompletedVisit(request, token, salon, oldLabel, "0981100002", 65);
    await seedClientWithCompletedVisit(request, token, salon, recentLabel, "0981100003", 5);

    await loginAsDemo(page);
    const rows = await widgetRows(page);

    const veryOldRow = rows.find((r) => hasLabel(r.fullName, veryOldLabel));
    const oldRow = rows.find((r) => hasLabel(r.fullName, oldLabel));
    const recentRow = rows.find((r) => hasLabel(r.fullName, recentLabel));

    expect(veryOldRow, "very-old (250d) client should appear").toBeTruthy();
    expect(oldRow, "old (65d, >=60d threshold) client should appear").toBeTruthy();
    expect(recentRow, "recently active (5d) client should NOT appear").toBeUndefined();

    // Contains phone + days-of-inactivity copy (small tolerance around a UTC midnight boundary).
    expect(veryOldRow?.phone).toBe("0981100001");
    const veryOldDays = Number(/(\d+)/.exec(veryOldRow?.inactivity ?? "")?.[1]);
    const oldDays = Number(/(\d+)/.exec(oldRow?.inactivity ?? "")?.[1]);
    expect(veryOldDays).toBeGreaterThanOrEqual(249);
    expect(veryOldDays).toBeLessThanOrEqual(251);
    expect(oldDays).toBeGreaterThanOrEqual(64);
    expect(oldDays).toBeLessThanOrEqual(66);

    // Ordered by days of inactivity descending: very-old (250d) before old (65d).
    const veryOldIndex = rows.findIndex((r) => hasLabel(r.fullName, veryOldLabel));
    const oldIndex = rows.findIndex((r) => hasLabel(r.fullName, oldLabel));
    expect(veryOldIndex).toBeGreaterThanOrEqual(0);
    expect(oldIndex).toBeGreaterThanOrEqual(0);
    expect(veryOldIndex).toBeLessThan(oldIndex);
  });

  test("AC1 · cliente activo sin ningún turno completado aparece como inactivo (nunca visitó)", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const suffix = Date.now();
    const label = `E2E216 NeverVisited ${suffix}`;
    await seedClient(request, token, label, "0981100004");

    await loginAsDemo(page);
    const rows = await widgetRows(page);
    const row = rows.find((r) => hasLabel(r.fullName, label));
    expect(row, "never-visited client should appear as inactive").toBeTruthy();
    expect(row?.inactivity).toBe("Never visited");
  });

  test("AC1 · cliente inactivo pero con active=false NO aparece en el panel", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const salon = await seedCategoryServiceProfessional(request, token);
    const suffix = Date.now();
    const label = `E2E216 InactiveFlag ${suffix}`;

    const inactiveClient = await seedClientWithCompletedVisit(
      request,
      token,
      salon,
      label,
      "0981100005",
      90,
    );
    const deactivateRes = await request.post(
      `${API_BASE}/api/clients/${inactiveClient.id}/deactivate`,
      { headers: authHeaders(token) },
    );
    expect(deactivateRes.ok(), await deactivateRes.text()).toBeTruthy();

    await loginAsDemo(page);
    const rows = await widgetRows(page);
    const row = rows.find((r) => hasLabel(r.fullName, label));
    expect(
      row,
      "client with active=false must be excluded even though it's 90d inactive",
    ).toBeUndefined();
  });

  test("AC3 · panel limitado a las 20 filas más inactivas (top N)", async ({ page, request }) => {
    // Clean slate so this test's own candidates aren't crowded out (or padded) by earlier tests'
    // clients — POST /api/admin/seed/reset wipes tenant 1's clients/appointments (HU-27) and needs
    // no prior auth.
    const resetRes = await request.post(`${API_BASE}/api/admin/seed/reset`);
    expect(resetRes.ok(), await resetRes.text()).toBeTruthy();

    const token = await loginAsDemoApi(request);
    const salon = await seedCategoryServiceProfessional(request, token);
    const suffix = Date.now();

    // 21 candidates, each strictly more inactive than the last (1000..1020 days ago) — the least
    // inactive of the 21 (1000d, Cap0) must be the one squeezed out by the top-20 cap.
    const CANDIDATE_COUNT = 21;
    for (let i = 0; i < CANDIDATE_COUNT; i++) {
      await seedClientWithCompletedVisit(
        request,
        token,
        salon,
        `E2E216 Cap${i} ${suffix}`,
        `09821${String(i).padStart(5, "0")}`,
        1000 + i,
      );
    }

    await loginAsDemo(page);
    const rows = await widgetRows(page);

    expect(rows).toHaveLength(20);
    expect(
      rows.some((r) => hasLabel(r.fullName, `E2E216 Cap0 ${suffix}`)),
      "least-inactive of the 21 (Cap0, 1000d) must be excluded by the cap",
    ).toBe(false);
    expect(
      rows.some((r) => hasLabel(r.fullName, `E2E216 Cap20 ${suffix}`)),
      "most-inactive of the 21 (Cap20, 1020d) must be present",
    ).toBe(true);
    expect(hasLabel(rows[0].fullName, `E2E216 Cap20 ${suffix}`)).toBe(true);
  });
});
