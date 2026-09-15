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
 * Issue #216 · "Panel de clientes inactivos" — Dashboard widget listing active clients with at
 * least one `COMPLETED` appointment whose most recent one is 90+ days old (clients who never had
 * a completed visit are excluded entirely — issue #216 follow-up), ordered by days of inactivity
 * descending, capped to the top 10 (see the "Ver todas" full paginated page for the rest).
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
  test("AC1/AC2 · cliente inactivo (90+ días) aparece con teléfono y días; cliente reciente no aparece; orden desc", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const salon = await seedCategoryServiceProfessional(request, token);
    const suffix = Date.now();

    const veryOldLabel = `E2E216 VeryOld ${suffix}`;
    const oldLabel = `E2E216 Old ${suffix}`;
    const recentLabel = `E2E216 Recent ${suffix}`;

    await seedClientWithCompletedVisit(request, token, salon, veryOldLabel, "0981100001", 250);
    await seedClientWithCompletedVisit(request, token, salon, oldLabel, "0981100002", 95);
    await seedClientWithCompletedVisit(request, token, salon, recentLabel, "0981100003", 5);

    await loginAsDemo(page);
    const rows = await widgetRows(page);

    const veryOldRow = rows.find((r) => hasLabel(r.fullName, veryOldLabel));
    const oldRow = rows.find((r) => hasLabel(r.fullName, oldLabel));
    const recentRow = rows.find((r) => hasLabel(r.fullName, recentLabel));

    expect(veryOldRow, "very-old (250d) client should appear").toBeTruthy();
    expect(oldRow, "old (95d, >=90d threshold) client should appear").toBeTruthy();
    expect(recentRow, "recently active (5d) client should NOT appear").toBeUndefined();

    // Contains phone + days-of-inactivity copy (small tolerance around a UTC midnight boundary).
    expect(veryOldRow?.phone).toBe("0981100001");
    const veryOldDays = Number(/(\d+)/.exec(veryOldRow?.inactivity ?? "")?.[1]);
    const oldDays = Number(/(\d+)/.exec(oldRow?.inactivity ?? "")?.[1]);
    expect(veryOldDays).toBeGreaterThanOrEqual(249);
    expect(veryOldDays).toBeLessThanOrEqual(251);
    expect(oldDays).toBeGreaterThanOrEqual(94);
    expect(oldDays).toBeLessThanOrEqual(96);

    // Ordered by days of inactivity descending: very-old (250d) before old (95d).
    const veryOldIndex = rows.findIndex((r) => hasLabel(r.fullName, veryOldLabel));
    const oldIndex = rows.findIndex((r) => hasLabel(r.fullName, oldLabel));
    expect(veryOldIndex).toBeGreaterThanOrEqual(0);
    expect(oldIndex).toBeGreaterThanOrEqual(0);
    expect(veryOldIndex).toBeLessThan(oldIndex);
  });

  test("AC1 follow-up · cliente activo sin ningún turno completado NO aparece (nunca visitó no es 'inactivo')", async ({
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
    expect(row, "a client who never had a completed visit must not appear as inactive").toBeUndefined();
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
      100,
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
      "client with active=false must be excluded even though it's 100d inactive",
    ).toBeUndefined();
  });

  test("AC3 · panel limitado a las 10 filas más inactivas (top N); «Ver todas» muestra la lista completa paginada", async ({
    page,
    request,
  }) => {
    // Clean slate so this test's own candidates aren't crowded out (or padded) by earlier tests'
    // clients — POST /api/admin/seed/reset wipes tenant 1's clients/appointments (HU-27) and needs
    // no prior auth.
    const resetRes = await request.post(`${API_BASE}/api/admin/seed/reset`);
    expect(resetRes.ok(), await resetRes.text()).toBeTruthy();

    const token = await loginAsDemoApi(request);
    const salon = await seedCategoryServiceProfessional(request, token);
    const suffix = Date.now();

    // 11 candidates, each strictly more inactive than the last (1000..1010 days ago) — the least
    // inactive of the 11 (1000d, Cap0) must be the one squeezed out by the top-10 cap, but still
    // reachable from the full paginated "Ver todas" page.
    const CANDIDATE_COUNT = 11;
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

    expect(rows).toHaveLength(10);
    expect(
      rows.some((r) => hasLabel(r.fullName, `E2E216 Cap0 ${suffix}`)),
      "least-inactive of the 11 (Cap0, 1000d) must be excluded by the cap",
    ).toBe(false);
    expect(
      rows.some((r) => hasLabel(r.fullName, `E2E216 Cap10 ${suffix}`)),
      "most-inactive of the 11 (Cap10, 1010d) must be present",
    ).toBe(true);
    expect(hasLabel(rows[0].fullName, `E2E216 Cap10 ${suffix}`)).toBe(true);

    // "Ver todas" navigates to the full paginated list, where all 11 (including Cap0) are reachable.
    await page.getByTestId("dashboard-inactive-clients-view-all").click();
    await expect(page).toHaveURL(/\/app\/inactive-clients$/);
    await expect(page.getByTestId("inactive-clients-row")).toHaveCount(10);

    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByTestId("inactive-clients-row")).toHaveCount(1);
    // Client full names are stored/rendered UPPERCASE (issue #155 AC3).
    await expect(page.getByTestId("inactive-clients-row").first()).toContainText(
      new RegExp(`E2E216 Cap0 ${suffix}`, "i"),
    );
  });
});
