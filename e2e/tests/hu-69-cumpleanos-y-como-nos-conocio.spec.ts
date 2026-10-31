import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  API_BASE,
  apiPostJson,
  authHeaders,
  calendarVisibleWeekSlotIso,
  createAppointmentApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
} from "../fixtures/api";
import { loginAs, loginAsDemo } from "../fixtures/auth";
import { openDashboardMore } from "../fixtures/dashboard";
import { PASSWORD, professionalWithAccess } from "../fixtures/commissions";

/**
 * HU-69 · Cumpleaños y "cómo nos conoció".
 *
 * "Today" is the server's business day (America/Asuncion, FemmeTimeProperties); the browser runs
 * in the same zone, as the PRD assumes for every user. AC3's "29/02 is celebrated on 28/02 in
 * common years" depends on the real clock, so its date arithmetic is covered by unit tests
 * (ClientBirthdayTest / clientBirthday.test.ts); here we check that 29/02 is accepted.
 */
const ZONE = "America/Asuncion";
test.use({ timezoneId: ZONE });
test.describe.configure({ mode: "serial" });

function uniq(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

/** Day/month/year of `instant` (default now) in the business zone, shifted by `plusDays`. */
function zonedDate(plusDays = 0, instant = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
  const [y, m, d] = parts.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + plusDays));
  return { day: date.getUTCDate(), month: date.getUTCMonth() + 1, year: date.getUTCFullYear() };
}

async function seedClient(
  request: APIRequestContext,
  token: string,
  name: string,
  extras: Record<string, unknown> = {},
): Promise<{ id: number; fullName: string }> {
  return apiPostJson(request, token, "/api/clients", {
    fullName: name,
    phone: `0982${String(Date.now()).slice(-6)}`,
    email: null,
    ruc: null,
    ...extras,
  });
}

test.describe("HU-69 · Cumpleaños y cómo nos conoció", () => {
  test("AC1, AC9, AC10, AC11 · alta con cumpleaños sin año y 'Otro' con detalle; edición agrega el año", async ({
    page,
  }) => {
    const name = `E2E69 Alta ${uniq()}`;
    await loginAsDemo(page);
    await page.goto("/app/clients");
    await page.getByRole("button", { name: "+ New client" }).first().click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Full name").fill(name);
    await dlg.getByLabel("Day").selectOption("15");
    await dlg.getByLabel("Month").selectOption({ label: "August" });
    // AC9: fixed options.
    const channel = dlg.getByLabel("How did they find us?");
    await expect(channel.locator("option")).toHaveText([
      "Not specified",
      "Instagram",
      "Facebook",
      "TikTok",
      "Google",
      "Referred by another client",
      "Walked by the salon",
      "Other",
    ]);
    // AC10: the detail only appears with "Other".
    await expect(dlg.getByLabel("Details (optional)")).toHaveCount(0);
    await channel.selectOption("OTRO");
    await dlg.getByLabel("Details (optional)").fill("Feria de belleza");
    await expect(dlg.getByLabel("Details (optional)")).toHaveAttribute("maxlength", "100");
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(dlg).toHaveCount(0);

    await page.getByPlaceholder(/Search by name, phone, or RUC/i).fill(name);
    await page.getByText(name.toUpperCase(), { exact: true }).first().click();
    // AC11 + AC4 (display).
    await expect(page.getByTestId("client-birthday-display")).toHaveText("Birthday: August 15");
    await expect(page.getByTestId("client-acquisition-display")).toHaveText(
      "Found us through: Other (Feria de belleza)",
    );

    // Edit: add the year → the age shows up; switching language translates the option.
    await page.getByLabel("Year (optional)").fill("1990");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Client updated successfully.")).toBeVisible();
    await expect(page.getByTestId("client-birthday-display")).toContainText("Birthday: August 15, 1990 · ");
    await expect(page.getByTestId("client-birthday-display")).toContainText("years old");
    await page.getByRole("button", { name: "ES", exact: true }).click();
    await expect(page.getByTestId("client-acquisition-display")).toHaveText(
      "Nos conoció por: Otro (Feria de belleza)",
    );
    await page.getByRole("button", { name: "EN", exact: true }).click();
  });

  test("AC2, AC3 · validación de fecha (UI y API) y 29/02 aceptado", async ({ page, request }) => {
    await loginAsDemo(page);
    await page.goto("/app/clients");
    await page.getByRole("button", { name: "+ New client" }).first().click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Full name").fill(`E2E69 Invalida ${uniq()}`);
    // 31/04 doesn't exist.
    await dlg.getByLabel("Day").selectOption("31");
    await dlg.getByLabel("Month").selectOption({ label: "April" });
    await dlg.getByRole("button", { name: "Save" }).click();
    const err = dlg.locator("#client-birthday-err");
    await expect(err).toHaveText(
      "Enter a valid date with day and month (the year is optional and can't be in the future), e.g. 15/08 or 15/08/1990.",
    );
    await expect(err).toHaveAttribute("role", "alert");
    await expect(dlg.getByLabel("Day")).toHaveAttribute("aria-invalid", "true");
    // Day without month is also rejected.
    await dlg.getByLabel("Month").selectOption("");
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(err).toBeVisible();
    // 29/02 without year is fine (AC3).
    await dlg.getByLabel("Day").selectOption("29");
    await dlg.getByLabel("Month").selectOption({ label: "February" });
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(dlg).toHaveCount(0);

    // API: same rules, error code.
    const token = await loginAsDemoApi(request);
    const nextYear = new Date().getFullYear() + 1;
    for (const extras of [
      { birthdayDay: 31, birthdayMonth: 4, birthdayYear: null },
      { birthdayDay: 1, birthdayMonth: 1, birthdayYear: nextYear },
      { birthdayDay: 29, birthdayMonth: 2, birthdayYear: 2001 },
      { birthdayDay: 10, birthdayMonth: null, birthdayYear: null },
    ]) {
      const res = await request.post(`${API_BASE}/api/clients`, {
        headers: authHeaders(token),
        data: { fullName: `E2E69 Api ${uniq()}`, phone: null, email: null, ruc: null, ...extras },
      });
      expect(res.status(), JSON.stringify(extras)).toBe(400);
      expect(await res.text()).toContain("INVALID_BIRTHDAY");
    }
    const tooLong = await request.post(`${API_BASE}/api/clients`, {
      headers: authHeaders(token),
      data: {
        fullName: `E2E69 Api ${uniq()}`,
        acquisitionChannel: "OTRO",
        acquisitionChannelOther: "x".repeat(101),
      },
    });
    expect(tooLong.status()).toBe(400);
    expect(await tooLong.text()).toContain("ACQUISITION_CHANNEL_OTHER_TOO_LONG");
  });

  test("AC4, AC5, AC7, AC8 · etiqueta en la ficha y tarjeta del dashboard (hoy / próximos 7 días / solo activas)", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const today = zonedDate(0);
    const inThree = zonedDate(3);
    const inTen = zonedDate(10);
    const id = uniq();
    const todayClient = await seedClient(request, token, `E2E69 Hoy ${id}`, {
      birthdayDay: today.day,
      birthdayMonth: today.month,
      birthdayYear: 1990,
    });
    const soonClient = await seedClient(request, token, `E2E69 Pronto ${id}`, {
      birthdayDay: inThree.day,
      birthdayMonth: inThree.month,
    });
    const laterClient = await seedClient(request, token, `E2E69 Lejos ${id}`, {
      birthdayDay: inTen.day,
      birthdayMonth: inTen.month,
    });
    const inactiveClient = await seedClient(request, token, `E2E69 Inactiva ${id}`, {
      birthdayDay: today.day,
      birthdayMonth: today.month,
    });
    const deact = await request.post(`${API_BASE}/api/clients/${inactiveClient.id}/deactivate`, {
      headers: authHeaders(token),
    });
    expect(deact.ok()).toBeTruthy();

    await loginAsDemo(page);
    await page.goto("/app");
    await openDashboardMore(page, "birthdays");
    const card = page.getByTestId("dashboard-birthdays");
    const todayList = card.getByTestId("dashboard-birthdays-today");
    await expect(todayList).toContainText(todayClient.fullName);
    await expect(todayList).toContainText(`turns ${today.year - 1990}`);
    // Phone shown for today's birthdays.
    const todayRow = todayList.getByRole("listitem").filter({ hasText: todayClient.fullName });
    await expect(todayRow).toContainText(/0982\d{6}/);
    await expect(card.getByTestId("dashboard-birthdays-upcoming")).toContainText(soonClient.fullName);
    // AC5: outside the 7-day window; AC7: inactive clients never show.
    await expect(card).not.toContainText(laterClient.fullName);
    await expect(card).not.toContainText(inactiveClient.fullName);

    // AC4: link to the profile, which shows the "birthday today" badge.
    await todayList.getByRole("link", { name: todayClient.fullName }).click();
    await expect(page).toHaveURL(new RegExp(`/app/clients/${todayClient.id}$`));
    await expect(page.getByTestId("client-birthday-today")).toHaveText("🎂 Birthday today");
    await page.goto(`/app/clients/${soonClient.id}`);
    await expect(page.getByTestId("client-birthday-display")).toBeVisible();
    await expect(page.getByTestId("client-birthday-today")).toHaveCount(0);
  });

  test("AC5 · sin cumpleaños próximos: mensaje vacío", async ({ page, request }) => {
    // The shared demo tenant may hold other specs' birthdays, so the empty state is checked with
    // a stubbed (but real-shaped) response after confirming the endpoint itself answers.
    const token = await loginAsDemoApi(request);
    const res = await request.get(`${API_BASE}/api/dashboard/birthdays`, { headers: authHeaders(token) });
    expect(res.status()).toBe(200);
    await page.route("**/api/dashboard/birthdays", (route) =>
      route.fulfill({ json: { today: [], upcoming: [], upcomingDays: 7 } }),
    );
    await loginAsDemo(page);
    await page.goto("/app");
    await openDashboardMore(page, "birthdays");
    await expect(page.getByTestId("dashboard-birthdays")).toContainText(
      "No birthdays in the next 7 days.",
    );
  });

  test("AC6, AC12 · ícono 🎂 en el turno para admin y profesional, sin revelar datos", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const token = await loginAsDemoApi(request);
    const salon = await seedCategoryServiceProfessional(request, token);
    const pro = await professionalWithAccess(request, token, `E2E69 Pro ${uniq()}`);
    const startAt = calendarVisibleWeekSlotIso(14, 0);
    const apptDay = zonedDate(0, new Date(startAt));
    const birthdayClient = await seedClient(request, token, `E2E69 Turno ${uniq()}`, {
      birthdayDay: apptDay.day,
      birthdayMonth: apptDay.month,
      birthdayYear: 1985,
      acquisitionChannel: "INSTAGRAM",
    });
    const otherDay = zonedDate(1, new Date(startAt));
    const plainClient = await seedClient(request, token, `E2E69 Turno Sin ${uniq()}`, {
      birthdayDay: otherDay.day,
      birthdayMonth: otherDay.month,
    });
    const withBirthday = await createAppointmentApi(request, token, {
      clientId: birthdayClient.id,
      professionalId: pro.id,
      serviceId: salon.serviceId,
      startAt,
    });
    const without = await createAppointmentApi(request, token, {
      clientId: plainClient.id,
      professionalId: pro.id,
      serviceId: salon.serviceId,
      startAt: calendarVisibleWeekSlotIso(16, 0),
    });

    // Admin.
    await loginAsDemo(page);
    await page.goto("/app/calendar?view=week");
    const badge = page.getByTestId(`birthday-badge-${withBirthday.id}`);
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAttribute("aria-label", "Client's birthday");
    await expect(page.getByTestId(`birthday-badge-${without.id}`)).toHaveCount(0);

    // Professional: same icon, no date / age / channel anywhere.
    await page.context().clearCookies();
    await page.evaluate(() => sessionStorage.clear());
    await loginAs(page, pro.email, PASSWORD);
    await page.goto("/app/calendar?view=week");
    await expect(page.getByTestId(`birthday-badge-${withBirthday.id}`)).toBeVisible();
    await page.getByTestId(`calendar-appt-${withBirthday.id}`).click();
    const detail = page.getByRole("dialog", { name: "Appointment detail" });
    await expect(detail.getByTestId("appointment-detail-birthday")).toHaveText("🎂 Client's birthday");
    await expect(detail).not.toContainText("1985");
    await expect(detail).not.toContainText("Instagram");

    // AC12 (backend): the professional's client list carries no birthday / channel.
    const login = await request.post(`${API_BASE}/api/auth/login`, {
      data: { email: pro.email, password: PASSWORD },
    });
    const proToken = ((await login.json()) as { accessToken: string }).accessToken;
    const list = await request.get(
      `${API_BASE}/api/clients?q=${encodeURIComponent(birthdayClient.fullName)}`,
      { headers: authHeaders(proToken) },
    );
    const rows = (await list.json()) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    for (const f of ["birthdayDay", "birthdayMonth", "birthdayYear", "acquisitionChannel", "acquisitionChannelOther"]) {
      expect(rows[0][f] ?? null, f).toBeNull();
    }
    expect(
      (await request.get(`${API_BASE}/api/dashboard/birthdays`, { headers: authHeaders(proToken) })).status(),
    ).toBe(403);
  });
});
