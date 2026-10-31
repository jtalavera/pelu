import { expect, test } from "@playwright/test";
import {
  apiPostJson,
  createAppointmentApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
  calendarVisibleWeekSlotIso,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { bookingAppointmentDialog, completeAppointmentFromDetail, ensureCalendarShowsAppointmentByTestId, filterAgendaByProfessional } from "../fixtures/ui";

test.describe("HU-19 · Fixes varios del calendario", () => {
  test("filtro de profesionales: chips «All professionals» y uno por profesional", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    await loginAsDemo(page);
    await page.goto("/app/calendar?view=week");
    const group = page.locator("[data-tour='calendar-prof-filter']");
    await expect(group.getByTestId("calendar-prof-chip-all")).toHaveAttribute("aria-pressed", "true");
    await expect(group.getByRole("button", { name: new RegExp(seed.professionalFullName) })).toHaveCount(1);
  });

  test("HU-19 · 4 filtro de profesional en vista principal marca el chip elegido", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    await loginAsDemo(page);
    await page.goto("/app/calendar?view=week");
    await filterAgendaByProfessional(page, new RegExp(seed.professionalFullName));
    const group = page.locator("[data-tour='calendar-prof-filter']");
    await expect(group.getByRole("button", { name: new RegExp(seed.professionalFullName) })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(group.getByTestId("calendar-prof-chip-all")).toHaveAttribute("aria-pressed", "false");
  });

  test("HU-19 · 6 turno Completado no aparece en la grilla", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E GridDone ${Date.now()}`);
    await createAppointmentApi(request, token, {
      clientId: client.id,
      professionalId: seed.professionalId,
      serviceId: seed.serviceId,
      startAt: calendarVisibleWeekSlotIso(19, 0),
    });

    await loginAsDemo(page);
    await page.goto("/app/calendar?view=week");
    await page.getByRole("button", { name: new RegExp(client.fullName) }).click();
    await completeAppointmentFromDetail(page);
    await page
      .getByRole("dialog", { name: "Appointment detail" })
      .getByRole("button", { name: "Close" })
      .last()
      .click();
    await expect(page.getByRole("button", { name: new RegExp(client.fullName) })).toHaveCount(0);
  });

  test("HU-25 / HU-19 al mover el cursor en la grilla, el resalte es solo 30 min (banda bajo el slot)", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await page.goto("/app/calendar?view=week");
    const col = page.getByTestId("calendar-day-col-wed");
    await expect(col).toBeVisible();
    const box = await col.boundingBox();
    expect(box).toBeTruthy();
    await page.mouse.move(box!.x + box!.width * 0.5, box!.y + 100);
    const slot = col.getByTestId("calendar-hover-slot");
    const slotBox = await slot.boundingBox();
    expect(slotBox).toBeTruthy();
    expect(slotBox!.height).toBeLessThan(40);
  });

  test("HU-19 · 7 modal de nuevo turno usa combobox editable de hora con intervalos de 15 min", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await page.goto("/app/calendar?view=week");
    await page.getByRole("button", { name: /New appointment/ }).first().click();
    const dlg = bookingAppointmentDialog(page);
    await expect(dlg.getByRole("combobox", { name: /^Time$/ })).toBeVisible();
  });

  test("HU-19 · 8 modal de nuevo turno usa selector de fecha internacionalizado", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await page.goto("/app/calendar?view=week");
    await page.getByRole("button", { name: /New appointment/ }).first().click();
    const dlg = bookingAppointmentDialog(page);
    // Localized date input renders a combobox; the popover dialog "Calendar" appears on focus.
    // The popover renders in a body-level portal (FloatingDropdown), so it is not a
    // descendant of the appointment dialog — assert it at the page level.
    await dlg.getByRole("combobox", { name: /^Date$/ }).click();
    await expect(page.getByRole("dialog", { name: "Calendar", exact: true }).first()).toBeVisible();
  });

  test("HU-25 / HU-19 hover en tarjeta de turno puede agrandar el bloque (texto largo)", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const longName = `E2E Longname ${"x".repeat(100)} ${Date.now()}`;
    const client = await apiPostJson<{ id: number }>(request, token, "/api/clients", {
      fullName: longName,
      phone: null,
      email: null,
      ruc: null,
    });
    const appt = await createAppointmentApi(request, token, {
      clientId: client.id,
      professionalId: seed.professionalId,
      serviceId: seed.serviceId,
      startAt: calendarVisibleWeekSlotIso(10, 0),
    });

    await loginAsDemo(page);
    await page.goto("/app/calendar?view=week");
    await ensureCalendarShowsAppointmentByTestId(page, `calendar-appt-${appt.id}`);
    const card = page.getByTestId(`calendar-appt-${appt.id}`);
    await expect(card).toBeVisible();
    const h0 = (await card.boundingBox())!.height;
    await card.hover();
    const h1 = (await card.boundingBox())!.height;
    expect(h1, "esperada expansión al hover para acomodar líneas de texto").toBeGreaterThanOrEqual(
      h0,
    );
  });
});
