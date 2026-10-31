import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { DEMO_EMAIL, DEMO_PASSWORD, loginAs } from "../fixtures/auth";
import {
  apiBaseUrl,
  apiGetJson,
  calendarVisibleWeekSlotIso,
  createAppointmentApi,
  seedCategoryServiceProfessional,
} from "../fixtures/api";

/** Gets an admin JWT for direct API calls. */
async function adminToken(baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD }),
  });
  if (!res.ok) throw new Error(`Admin login failed: ${res.status}`);
  const data = (await res.json()) as { accessToken: string };
  if (!data.accessToken) throw new Error("Admin login returned no accessToken");
  return data.accessToken;
}

/** Creates a professional, grants access, activates with given password. Returns professionalId. */
async function setupProfessionalWithAccess(
  base: string,
  name: string,
  email: string,
  password: string,
): Promise<number> {
  const token = await adminToken(base);

  const createRes = await fetch(`${base}/api/professionals`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ fullName: name, email }),
  });
  if (!createRes.ok) throw new Error(`Create professional failed: ${createRes.status}`);
  const created = (await createRes.json()) as { id: number };
  const profId = created.id;

  const grantRes = await fetch(`${base}/api/professionals/${profId}/grant-access`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!grantRes.ok) throw new Error(`Grant access failed: ${grantRes.status}`);
  const { rawToken } = (await grantRes.json()) as { rawToken: string };

  const activateRes = await fetch(`${base}/api/auth/activate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: rawToken, password, confirmPassword: password }),
  });
  if (!activateRes.ok) throw new Error(`Activate failed: ${activateRes.status}`);

  return profId;
}

/** Picks a chip of the calendar's professional filter. */
async function pickCalendarFilter(page: Page, label: string): Promise<void> {
  const group = page.locator("[data-tour='calendar-prof-filter']");
  const chip = label === "All professionals" ? group.getByTestId("calendar-prof-chip-all") : group.getByRole("button", { name: label, exact: true });
  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
}

/** Logs a professional in through the API and returns her JWT. */
async function professionalToken(request: APIRequestContext, email: string): Promise<string> {
  const res = await request.post(`${apiBaseUrl()}/api/auth/login`, {
    data: { email, password: "ValidPass1!" },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return ((await res.json()) as { accessToken: string }).accessToken;
}

test.describe("HU-24 · Vista del profesional logueado", () => {
  test("HU-24 · 1+2 profesional puede iniciar sesión y el sistema detecta su rol", async ({ page }) => {
    const base = apiBaseUrl();
    const email = `hu24login${Date.now()}@test.com`;
    await setupProfessionalWithAccess(base, `E2E Login ${Date.now()}`, email, "ValidPass1!");

    await loginAs(page, email, "ValidPass1!");
    // Professional role redirects to /app/calendar
    await expect(page).toHaveURL(/\/app\/calendar/);
  });

  test("HU-24 · 3 calendario visible tras iniciar sesión como profesional", async ({ page }) => {
    const base = apiBaseUrl();
    const email = `hu24cal${Date.now()}@test.com`;
    await setupProfessionalWithAccess(base, `E2E Cal ${Date.now()}`, email, "ValidPass1!");

    await loginAs(page, email, "ValidPass1!");
    await page.goto("/app/calendar?view=week");
    // "Today" button is always visible in the calendar header
    await expect(page.getByRole("button", { name: /today/i })).toBeVisible();
  });

  // Issue #38 follow-up: professionals browse every agenda and may filter by professional;
  // the calendar opens on their own agenda.
  test("HU-24 · 4+5 la profesional ve todos los turnos y puede filtrar por profesional (abre en su agenda)", async ({
    page,
    request,
  }) => {
    const base = apiBaseUrl();
    const suffix = Date.now();
    const email = `hu24filt${suffix}@test.com`;
    const ownName = `E2E Filt Own ${suffix}`;
    const ownId = await setupProfessionalWithAccess(base, ownName, email, "ValidPass1!");
    const admin = await adminToken(base);
    const salon = await seedCategoryServiceProfessional(request, admin);
    const own = await createAppointmentApi(request, admin, {
      clientId: null,
      professionalId: ownId,
      serviceId: salon.serviceId,
      startAt: calendarVisibleWeekSlotIso(9, 0),
    });
    const other = await createAppointmentApi(request, admin, {
      clientId: null,
      professionalId: salon.professionalId,
      serviceId: salon.serviceId,
      startAt: calendarVisibleWeekSlotIso(11, 0),
    });

    await loginAs(page, email, "ValidPass1!");
    await page.goto("/app/calendar?view=week");
    await expect(page.getByRole("button", { name: /today/i })).toBeVisible();
    // The filter is there, preselected on her own agenda.
    const filter = page.locator("[data-tour='calendar-prof-filter']");
    await expect(filter).toBeVisible();
    await expect(filter.getByRole("button", { name: ownName.toUpperCase(), exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByTestId(`calendar-appt-${own.id}`)).toBeVisible();
    await expect(page.getByTestId(`calendar-appt-${other.id}`)).toHaveCount(0);

    // "All professionals" shows the other professional's appointment too.
    await pickCalendarFilter(page, "All professionals");
    await expect(page.getByTestId(`calendar-appt-${own.id}`)).toBeVisible();
    await expect(page.getByTestId(`calendar-appt-${other.id}`)).toBeVisible();

    // Filtering by the other professional shows only hers.
    await pickCalendarFilter(page, salon.professionalFullName);
    await expect(page.getByTestId(`calendar-appt-${other.id}`)).toBeVisible();
    await expect(page.getByTestId(`calendar-appt-${own.id}`)).toHaveCount(0);

    // Same through the API: no forced filter, any professionalId filter works.
    const profToken = await professionalToken(request, email);
    const from = new Date(Date.now() - 14 * 86400000).toISOString();
    const to = new Date(Date.now() + 21 * 86400000).toISOString();
    const all = await apiGetJson<Array<{ id: number }>>(
      request,
      profToken,
      `/api/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    );
    expect(all.map((x) => x.id)).toEqual(expect.arrayContaining([own.id, other.id]));
    const onlyOther = await apiGetJson<Array<{ id: number; professionalId: number }>>(
      request,
      profToken,
      `/api/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&professionalId=${salon.professionalId}`,
    );
    expect(onlyOther.length).toBeGreaterThan(0);
    expect(onlyOther.every((x) => x.professionalId === salon.professionalId)).toBeTruthy();
  });

  test("HU-24 · 12 sin acceso al módulo de gestión de profesionales (menú, URL y API)", async ({ page, request }) => {
    const base = apiBaseUrl();
    const email = `hu24noprof${Date.now()}@test.com`;
    const profId = await setupProfessionalWithAccess(base, `E2E NoProf ${Date.now()}`, email, "ValidPass1!");

    await loginAs(page, email, "ValidPass1!");
    // Wait for AppShell to render with role loaded
    await expect(page.getByRole("button", { name: /today/i })).toBeVisible();
    // Professionals nav link should not be in the DOM for professional role
    await expect(page.getByRole("link", { name: /^professionals$/i })).not.toBeVisible();
    // Typing the URL sends her back to the calendar.
    await page.goto("/app/professionals");
    await expect(page).toHaveURL(/\/app\/calendar/);

    // The API refuses the management endpoints (PIN, access, ABM) to a professional token.
    const profToken = await professionalToken(request, email);
    const headers = { Authorization: `Bearer ${profToken}`, "Content-Type": "application/json" };
    expect((await request.get(`${base}/api/professionals/page`, { headers })).status()).toBe(403);
    expect(
      (await request.put(`${base}/api/professionals/${profId}`, { headers, data: { fullName: "X" } })).status(),
    ).toBe(403);
    expect((await request.post(`${base}/api/professionals/${profId}/grant-access`, { headers })).status()).toBe(403);
    // The read-only list she gets (calendar filter) carries no colleagues' contact or access data.
    const list = await apiGetJson<Array<{ id: number; email: string | null; phone: string | null; systemAccessAllowed: boolean }>>(
      request,
      profToken,
      "/api/professionals",
    );
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((p) => p.email === null && p.phone === null && p.systemAccessAllowed === false)).toBeTruthy();
  });

  test("HU-24 · 13 sin acceso a módulos administrativos (menú, URL y API) ni a Stock", async ({ page, request }) => {
    const base = apiBaseUrl();
    const email = `hu24noadmin${Date.now()}@test.com`;
    await setupProfessionalWithAccess(base, `E2E NoAdmin ${Date.now()}`, email, "ValidPass1!");

    await loginAs(page, email, "ValidPass1!");
    // Wait for AppShell to render with role loaded
    await expect(page.getByRole("button", { name: /today/i })).toBeVisible();
    // Dashboard and Settings nav items should not be in the DOM for professional role
    await expect(page.getByRole("link", { name: /^dashboard$/i })).not.toBeVisible();
    await expect(page.getByRole("link", { name: /^(settings|business settings)$/i })).not.toBeVisible();
    await expect(page.getByRole("link", { name: /^billing$/i })).not.toBeVisible();
    // Issue #38 follow-up: no Stock for professionals.
    await expect(page.getByTestId("nav-stock")).toHaveCount(0);

    // Typing an admin URL redirects to the calendar. (/app/clients is no longer one: since HU-68
    // professionals get a restricted name list there — covered by hu-68's spec.)
    for (const path of ["/app", "/app/billing", "/app/settings/business", "/app/dashboards", "/app/inactive-clients"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/app\/calendar/);
    }

    // And the API answers 403 for business settings, cash, invoices, dashboards, tips and Stock.
    const profToken = await professionalToken(request, email);
    const headers = { Authorization: `Bearer ${profToken}`, "Content-Type": "application/json" };
    for (const path of [
      "/api/business-profile",
      "/api/cash-sessions/current",
      "/api/invoices",
      "/api/dashboard",
      "/api/propinas/balance",
      "/api/service-records",
      "/api/fiscal-stamps",
    ]) {
      expect((await request.get(`${base}${path}`, { headers })).status(), path).toBe(403);
    }
    expect((await request.post(`${base}/api/cash-sessions/open`, { headers, data: {} })).status()).toBe(403);
    expect((await request.post(`${base}/api/sso/stock`, { headers })).status()).toBe(403);
  });

  test("HU-24 · 7+8 profesional puede agendar turno con campo profesional fijo", async ({ page }) => {
    const base = apiBaseUrl();
    const suffix = Date.now();
    const email = `hu24book${suffix}@test.com`;
    const name = `E2E Book ${suffix}`;
    await setupProfessionalWithAccess(base, name, email, "ValidPass1!");

    await loginAs(page, email, "ValidPass1!");
    await page.goto("/app/calendar?view=week");
    await expect(page.getByRole("button", { name: /today/i })).toBeVisible();

    // Open new appointment form (first button = header button with visible text, not calendar slot buttons)
    await page.getByRole("button", { name: "New appointment" }).first().click();
    const dlg = page.getByRole("dialog");

    // The SearchableSelect for professional should NOT be visible (replaced by read-only div)
    await expect(dlg.locator("#form-professional")).not.toBeVisible();
    // The professional's own name should appear in the read-only field
    await expect(dlg.getByText(name)).toBeVisible();
  });

  test("HU-24 · 10 profesional no puede reasignar turno propio a otra profesional (API)", async ({ request }) => {
    const base = apiBaseUrl();
    const token = await adminToken(base);
    const suffix = Date.now();

    // Create two professionals
    const email1 = `hu24own${suffix}@test.com`;
    const profId1 = await setupProfessionalWithAccess(base, `E2E Own ${suffix}`, email1, "ValidPass1!");

    const createProf2Res = await request.post(`${base}/api/professionals`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      data: { fullName: `E2E Other ${suffix}`, email: null },
    });
    const { id: profId2 } = (await createProf2Res.json()) as { id: number };

    // Get prof1's JWT
    const loginRes = await request.post(`${base}/api/auth/login`, {
      data: { email: email1, password: "ValidPass1!" },
    });
    const { accessToken: profToken } = (await loginRes.json()) as { accessToken: string };

    // Try to create an appointment assigned to prof2 using prof1's token
    // serviceId=1 satisfies @NotNull validation; 403 is thrown before service layer
    const apptRes = await request.post(`${base}/api/appointments`, {
      headers: { Authorization: `Bearer ${profToken}`, "Content-Type": "application/json" },
      data: {
        professionalId: profId2,
        serviceId: 1,
        clientId: null,
        startAt: new Date(Date.now() + 86400000).toISOString(),
      },
    });
    // Should be rejected with 403 — professional can only book for themselves
    expect(apptRes.status()).toBe(403);
  });

  // Issue #38 follow-up: another professional's appointment is visible (read-only) but any
  // modification is rejected with 403.
  test("HU-24 · 11 la profesional ve el turno de otra pero no puede modificarlo (UI + 403)", async ({
    page,
    request,
  }) => {
    const base = apiBaseUrl();
    const suffix = Date.now();
    const email = `hu24ro${suffix}@test.com`;
    const ownId = await setupProfessionalWithAccess(base, `E2E RO ${suffix}`, email, "ValidPass1!");
    const admin = await adminToken(base);
    const salon = await seedCategoryServiceProfessional(request, admin);
    const startAt = calendarVisibleWeekSlotIso(14, 0);
    const other = await createAppointmentApi(request, admin, {
      clientId: null,
      professionalId: salon.professionalId,
      serviceId: salon.serviceId,
      startAt,
    });
    const own = await createAppointmentApi(request, admin, {
      clientId: null,
      professionalId: ownId,
      serviceId: salon.serviceId,
      startAt: calendarVisibleWeekSlotIso(16, 0),
    });

    const profToken = await professionalToken(request, email);
    const headers = { Authorization: `Bearer ${profToken}`, "Content-Type": "application/json" };
    // Reading it is fine...
    const getRes = await request.get(`${base}/api/appointments/${other.id}`, { headers });
    expect(getRes.status()).toBe(200);
    // ...editing it (even taking it over), or changing its status, is not.
    const putRes = await request.put(`${base}/api/appointments/${other.id}`, {
      headers,
      data: { clientId: null, professionalId: ownId, serviceId: salon.serviceId, startAt },
    });
    expect(putRes.status()).toBe(403);
    expect(await putRes.text()).toContain("APPOINTMENT_NOT_OWNED_BY_PROFESSIONAL");
    const statusRes = await request.patch(`${base}/api/appointments/${other.id}/status`, {
      headers,
      data: { status: "CANCELLED", cancelReason: null },
    });
    expect(statusRes.status()).toBe(403);
    // Her own appointment's status she can change.
    const ownStatus = await request.patch(`${base}/api/appointments/${own.id}/status`, {
      headers,
      data: { status: "CONFIRMED", cancelReason: null },
    });
    expect(ownStatus.ok()).toBeTruthy();

    // UI: the other's appointment opens read-only (no edit / change status), hers does not.
    await loginAs(page, email, "ValidPass1!");
    await page.goto("/app/calendar?view=week");
    await expect(page.getByRole("button", { name: /today/i })).toBeVisible();
    // Filter by the other professional (a crowded "all" grid can squeeze the block too thin to click).
    await pickCalendarFilter(page, salon.professionalFullName);
    await page.getByTestId(`calendar-appt-${other.id}`).click();
    let dlg = page.getByRole("dialog");
    await expect(dlg.getByTestId("appointment-read-only-notice")).toBeVisible();
    await expect(dlg.getByRole("button", { name: /edit appointment/i })).toHaveCount(0);
    await expect(dlg.getByRole("button", { name: /change status/i })).toHaveCount(0);
    await dlg.getByRole("button", { name: /close/i }).first().click();

    await pickCalendarFilter(page, `E2E RO ${suffix}`.toUpperCase());
    await page.getByTestId(`calendar-appt-${own.id}`).click();
    dlg = page.getByRole("dialog");
    await expect(dlg.getByTestId("appointment-read-only-notice")).toHaveCount(0);
    await expect(dlg.getByRole("button", { name: /change status/i })).toBeVisible();
  });
});
