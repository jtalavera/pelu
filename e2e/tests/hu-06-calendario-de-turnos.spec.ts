import { expect, test } from "@playwright/test";
import {
  API_BASE,
  apiPostJson,
  authHeaders,
  createAppointmentApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
  calendarVisibleWeekSlotIso,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { ensureCalendarShowsClientCard, pickSearchableOption } from "../fixtures/ui";

test.describe("HU-06 · Calendario de turnos", () => {
  test("HU-06 · 1 y · 3 vista semanal y navegación de semanas", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/calendar");
    const range = page.locator("span").filter({ hasText: /–/ }).first();
    const before = await range.innerText();
    await page.getByRole("button", { name: "Next week" }).click();
    const after = await range.innerText();
    expect(after.length).toBeGreaterThan(0);
    expect(after).not.toBe(before);
    await page.getByRole("button", { name: "Previous week" }).click();
    const back = await range.innerText();
    expect(back).toBe(before);
  });

  test("HU-06 · 2 tarjeta muestra cliente, servicio y profesional", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E Cal ${Date.now()}`);
    const startAt = calendarVisibleWeekSlotIso(11, 0);
    await createAppointmentApi(request, token, {
      clientId: client.id,
      professionalId: seed.professionalId,
      serviceId: seed.serviceId,
      startAt,
    });

    await loginAsDemo(page);
    await page.goto("/app/calendar");

    await ensureCalendarShowsClientCard(page, new RegExp(client.fullName));
    const appointmentButton = page.getByRole("button", { name: new RegExp(client.fullName) });
    await expect(appointmentButton).toBeVisible();
    await expect(appointmentButton.getByText(/E2E Svc /)).toBeVisible();
    await expect(appointmentButton.getByText(seed.professionalFullName)).toBeVisible();
  });

  test("HU-06 · 4 filtro por profesional reduce resultados", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    await apiPostJson<{ id: number }>(request, token, "/api/professionals", {
      fullName: `E2E Prof B ${Date.now()}`,
      phone: null,
      email: null,
      photoDataUrl: null,
    });
    const client = await seedClient(request, token, `E2E Filt ${Date.now()}`);
    await createAppointmentApi(request, token, {
      clientId: client.id,
      professionalId: seed.professionalId,
      serviceId: seed.serviceId,
      startAt: calendarVisibleWeekSlotIso(12, 0),
    });

    await loginAsDemo(page);
    await page.goto("/app/calendar");
    // Names are stored in UPPERCASE (issue #155 AC3) — match case-insensitively.
    await pickSearchableOption(page, "Filter by professional", "E2E Prof B", /E2E Prof B/i);
    await expect(page.getByRole("button", { name: client.fullName, exact: false })).toHaveCount(0);
    await pickSearchableOption(page, "Filter by professional", "All", /All professionals/);
    await ensureCalendarShowsClientCard(page, client.fullName);
  });

  test("HU-06 · 5 clic en tarjeta abre detalle", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E Det ${Date.now()}`);
    await createAppointmentApi(request, token, {
      clientId: client.id,
      professionalId: seed.professionalId,
      serviceId: seed.serviceId,
      startAt: calendarVisibleWeekSlotIso(13, 0),
    });

    await loginAsDemo(page);
    await page.goto("/app/calendar");
    await ensureCalendarShowsClientCard(page, client.fullName);
    await page.getByRole("button", { name: client.fullName, exact: false }).click();
    await expect(page.getByRole("heading", { name: "Appointment detail" })).toBeVisible();
    await expect(page.getByText("Client", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("dialog", { name: "Appointment detail" }).getByText(client.fullName, { exact: true }),
    ).toBeVisible();
  });

  test("HU-06 · 6 turno con recordatorio ya enviado muestra el indicador en la tarjeta y en el detalle", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);

    // Reminded appointment — AppointmentReminderScheduler is disabled under the e2e profile
    // (app.femme.email.enabled=false), so mark-reminder-sent stands in for it here.
    const remindedClient = await seedClient(request, token, `E2E Rem ${Date.now()}`);
    const remindedAppt = await createAppointmentApi(request, token, {
      clientId: remindedClient.id,
      professionalId: seed.professionalId,
      serviceId: seed.serviceId,
      startAt: calendarVisibleWeekSlotIso(9, 0),
    });
    const markRes = await request.post(
      `${API_BASE}/api/admin/appointment-test-support/${remindedAppt.id}/mark-reminder-sent`,
      { headers: authHeaders(token) },
    );
    expect(markRes.ok(), await markRes.text()).toBeTruthy();

    // Control: a second appointment that was never reminded must show no indicator.
    const plainClient = await seedClient(request, token, `E2E NoRem ${Date.now()}`);
    await createAppointmentApi(request, token, {
      clientId: plainClient.id,
      professionalId: seed.professionalId,
      serviceId: seed.serviceId,
      startAt: calendarVisibleWeekSlotIso(15, 0),
    });

    await loginAsDemo(page);
    await page.goto("/app/calendar");

    await ensureCalendarShowsClientCard(page, remindedClient.fullName);
    const remindedButton = page.getByRole("button", { name: remindedClient.fullName, exact: false });
    await expect(remindedButton.getByTestId(`reminder-sent-badge-${remindedAppt.id}`)).toBeVisible();

    await ensureCalendarShowsClientCard(page, plainClient.fullName);
    const plainButton = page.getByRole("button", { name: plainClient.fullName, exact: false });
    await expect(plainButton.locator('[data-testid^="reminder-sent-badge-"]')).toHaveCount(0);

    await remindedButton.click();
    await expect(page.getByRole("heading", { name: "Appointment detail" })).toBeVisible();
    await expect(page.getByText("Reminder sent", { exact: true })).toBeVisible();
    await expect(page.getByTestId(`reminder-sent-${remindedAppt.id}`)).toBeVisible();
  });
});
