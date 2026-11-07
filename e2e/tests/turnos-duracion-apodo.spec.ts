import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  API_BASE,
  apiGetJson,
  apiPostJson,
  authHeaders,
  createAppointmentApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { goToCatalog } from "../fixtures/catalog";
import {
  bookingAppointmentDialog,
  fillAppointmentDateIso,
  fillAppointmentTime,
  localDatePlusDays,
  pickSearchableOption,
} from "../fixtures/ui";

/**
 * Turnos: (1) el día elegido de la tira se lee en blanco, (2) la duración del turno se puede
 * cambiar al crear y editar, (3) la profesional puede tener un apodo que reemplaza su nombre en
 * las listas.
 */
test.describe.configure({ mode: "serial" });

type Appt = { id: number; startAt: string; endAt: string; durationMinutes: number; professionalName: string };

function minutesBetween(a: Appt): number {
  return (new Date(a.endAt).getTime() - new Date(a.startAt).getTime()) / 60_000;
}

async function appointmentsOf(request: APIRequestContext, token: string, professionalId: number): Promise<Appt[]> {
  const from = new Date();
  const to = new Date(Date.now() + 10 * 24 * 3600_000);
  return apiGetJson<Appt[]>(
    request,
    token,
    `/api/appointments?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}&professionalId=${professionalId}`,
  );
}

function rxExact(s: string): RegExp {
  return new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

test.describe("Fecha seleccionada", () => {
  test("el día elegido de la tira de la Agenda tiene letras blancas sobre el verde", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/calendar");
    const selected = page.locator('[data-testid^="calendar-strip-"].bg-primary').first();
    await expect(selected).toBeVisible({ timeout: 20_000 });
    for (const part of ["small", "b", "i"]) {
      const color = await selected.locator(part).first().evaluate((el) => getComputedStyle(el).color);
      expect(color, `color de <${part}>`).toBe("rgb(255, 255, 255)");
    }
    // A day that is not selected keeps the dark text.
    const other = page.locator('[data-testid^="calendar-strip-"]:not(.bg-primary)').first();
    const otherColor = await other.locator("b").first().evaluate((el) => getComputedStyle(el).color);
    expect(otherColor).not.toBe("rgb(255, 255, 255)");
  });
});

test.describe("Duración del turno", () => {
  test("al crear: arranca con la del servicio, se ajusta y el turno ocupa ese tiempo", async ({ page, request }) => {
    const admin = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, admin);
    const client = await seedClient(request, admin, `E2E Dur ${Date.now()}`);

    await loginAsDemo(page);
    await page.goto("/app/calendar?view=week");
    await page.getByRole("button", { name: "New appointment" }).first().click();
    const dlg = bookingAppointmentDialog(page);
    await fillAppointmentDateIso(dlg, localDatePlusDays(1));
    await fillAppointmentTime(dlg, "14:30");
    await pickSearchableOption(page, "Professional", seed.professionalFullName.slice(0, 9), rxExact(seed.professionalFullName));
    await pickSearchableOption(page, "Service", seed.serviceFullName.slice(0, 9), rxExact(seed.serviceFullName));
    await pickSearchableOption(page, "Client", client.fullName, new RegExp(client.fullName));

    const input = dlg.getByTestId("appointment-duration-input");
    const serviceMinutes = Number(await input.inputValue());
    expect(serviceMinutes).toBeGreaterThanOrEqual(5);
    // + / − move in steps of 5; the hint says when the turno ends.
    await dlg.getByTestId("appointment-duration-plus").click();
    await expect(input).toHaveValue(String(serviceMinutes + 5));
    await dlg.getByTestId("appointment-duration-minus").click();
    await expect(input).toHaveValue(String(serviceMinutes));
    await dlg.getByTestId("appointment-duration-presets").getByRole("button", { name: "90", exact: true }).click();
    await expect(input).toHaveValue("90");
    await expect(dlg.getByTestId("appointment-duration-ends")).toContainText("14:30 → 16:00");
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(dlg).toBeHidden({ timeout: 15_000 });

    const appts = await appointmentsOf(request, admin, seed.professionalId);
    expect(appts).toHaveLength(1);
    expect(minutesBetween(appts[0])).toBe(90);
    expect(appts[0].durationMinutes).toBe(90);
  });

  test("al editar: muestra la duración actual y se puede extender", async ({ page, request }) => {
    const admin = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, admin);
    const client = await seedClient(request, admin, `E2E DurEdit ${Date.now()}`);
    const start = new Date(Date.now() + 24 * 3600_000);
    start.setHours(15, 0, 0, 0);
    const turno = await createAppointmentApi(request, admin, {
      clientId: client.id,
      professionalId: seed.professionalId,
      serviceId: seed.serviceId,
      startAt: start.toISOString(),
    });

    await loginAsDemo(page);
    await page.goto("/app/calendar", { state: { selectedDate: start.toLocaleDateString("sv-SE"), openAppointmentId: turno.id } } as never);
    // Open the turno from the Inicio's navigation state: go through the day strip instead.
    await page.goto("/app/calendar?view=week");
    await page.getByRole("button", { name: new RegExp(client.fullName) }).first().click({ timeout: 20_000 });
    await page.getByTestId("calendar-more-actions").click();
    await page.getByTestId("calendar-action-edit").click();
    const dlg = bookingAppointmentDialog(page);
    const input = dlg.getByTestId("appointment-duration-input");
    const current = (await appointmentsOf(request, admin, seed.professionalId))[0];
    await expect(input).toHaveValue(String(minutesBetween(current)));
    await input.fill("135");
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(dlg).toBeHidden({ timeout: 15_000 });

    const after = (await appointmentsOf(request, admin, seed.professionalId))[0];
    expect(minutesBetween(after)).toBe(135);
  });

  test("API: se rechaza una duración fuera de 5–480 min y un choque usa el fin ampliado", async ({ request }) => {
    const admin = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, admin);
    const client = await seedClient(request, admin, `E2E DurApi ${Date.now()}`);
    const start = new Date(Date.now() + 2 * 24 * 3600_000);
    start.setHours(10, 0, 0, 0);
    const body = (startAt: Date, durationMinutes: number) => ({
      clientId: client.id,
      professionalId: seed.professionalId,
      serviceId: seed.serviceId,
      startAt: startAt.toISOString(),
      durationMinutes,
    });
    for (const bad of [0, 4, 481]) {
      const res = await request.post(`${API_BASE}/api/appointments`, { headers: authHeaders(admin), data: body(start, bad) });
      expect(res.status()).toBe(400);
      expect(await res.text()).toContain("APPOINTMENT_DURATION_INVALID");
    }
    await apiPostJson(request, admin, "/api/appointments", body(start, 120));
    // 90 minutes after the start is still inside the first turno (it runs 120).
    const clash = new Date(start.getTime() + 90 * 60_000);
    const res = await request.post(`${API_BASE}/api/appointments`, { headers: authHeaders(admin), data: body(clash, 15) });
    expect(res.status()).toBe(409);
    expect(await res.text()).toContain("APPOINTMENT_OVERLAP");
  });
});

test.describe("Apodo de la profesional", () => {
  test("con apodo, las listas lo muestran en lugar del nombre completo; sin apodo, el nombre", async ({ page, request }) => {
    const admin = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, admin);
    const nick = `Ani${Date.now() % 100000}`;
    const withNick = await apiPostJson<{ id: number; fullName: string; nickname: string | null; displayName: string }>(
      request,
      admin,
      "/api/professionals",
      { fullName: `E2E Con Apodo ${Date.now()}`, email: null, nickname: nick },
    );
    expect(withNick.nickname).toBe(nick);
    expect(withNick.displayName).toBe(nick);

    // A turno of hers: the turno's professional name is the nickname too.
    const client = await seedClient(request, admin, `E2E Apodo ${Date.now()}`);
    const slot = new Date(Date.now() + 5 * 60_000);
    slot.setSeconds(0, 0);
    const turno = await createAppointmentApi(request, admin, {
      clientId: client.id,
      professionalId: withNick.id,
      serviceId: seed.serviceId,
      startAt: slot.toISOString(),
    });
    const got = await apiGetJson<{ professionalName: string }>(request, admin, `/api/appointments/${turno.id}`);
    expect(got.professionalName).toBe(nick);

    await loginAsDemo(page);
    await page.goto("/app/calendar");
    await page.getByTestId("calendar-prof-trigger").click();
    const panel = page.getByTestId("calendar-prof-panel");
    await expect(panel.getByTestId(`calendar-prof-chip-${withNick.id}`)).toHaveText(nick, { timeout: 20_000 });
    // One without a nickname keeps the full name.
    await expect(panel.getByTestId(`calendar-prof-chip-${seed.professionalId}`)).toHaveText(seed.professionalFullName);
    await page.keyboard.press("Escape");

    // The turno form's picker offers her by nickname (the option text is exactly the nickname).
    await page.getByRole("button", { name: "New appointment" }).first().click();
    await expect(bookingAppointmentDialog(page)).toBeVisible();
    await pickSearchableOption(page, "Professional", nick, rxExact(nick));
  });

  test("en el Catálogo se carga el apodo (opcional) y se guarda; vacío vuelve al nombre", async ({ page, request }) => {
    const admin = await loginAsDemoApi(request);
    const fullName = `E2E Cat Apodo ${Date.now()}`;
    await loginAsDemo(page);
    await goToCatalog(page, "professionals");
    await page.getByRole("button", { name: "+ New professional" }).click();
    const dlg = page.getByRole("dialog", { name: /^(New professional|Edit professional)$/ });
    await dlg.locator("#prof-name").fill(fullName);
    await expect(dlg.locator("#prof-nickname")).toBeVisible();
    await dlg.locator("#prof-nickname").fill("Lau");
    await Promise.all([
      page.waitForResponse((r) => /\/api\/professionals\/\d+\/schedules/.test(new URL(r.url()).pathname) && r.request().method() === "PUT", { timeout: 30_000 }),
      dlg.getByTestId("prof-save").click(),
    ]);
    await expect(dlg).toBeHidden({ timeout: 15_000 });

    const list = await apiGetJson<{ id: number; fullName: string; nickname: string | null; displayName: string }[]>(request, admin, "/api/professionals");
    const saved = list.find((p) => p.fullName === fullName.toUpperCase())!;
    expect(saved.nickname).toBe("Lau");
    expect(saved.displayName).toBe("Lau");

    // Clearing the nickname brings the full name back everywhere.
    const res = await request.put(`${API_BASE}/api/professionals/${saved.id}`, {
      headers: authHeaders(admin),
      data: { fullName: saved.fullName, nickname: "  " },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const cleared = (await res.json()) as { nickname: string | null; displayName: string };
    expect(cleared.nickname).toBeNull();
    expect(cleared.displayName).toBe(fullName.toUpperCase());
  });
});
