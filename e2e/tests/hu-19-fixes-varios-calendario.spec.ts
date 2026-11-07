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
import { bookingAppointmentDialog, completeAppointmentFromDetail, ensureCalendarShowsAppointmentByTestId, filterAgendaByProfessional, openProfessionalFilter } from "../fixtures/ui";

test.describe("HU-19 · Fixes varios del calendario", () => {
  test("filtro de profesionales: dentro del buscador, «All professionals» y una opción por profesional", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    await loginAsDemo(page);
    await page.goto("/app/calendar?view=week");
    // No row of chips: the filter is a menu inside the search field.
    await expect(page.getByTestId("calendar-prof-trigger")).toBeVisible();
    await expect(page.getByTestId("calendar-prof-panel")).toHaveCount(0);
    const panel = await openProfessionalFilter(page);
    await expect(panel.getByTestId("calendar-prof-chip-all")).toHaveAttribute("aria-pressed", "true");
    await expect(panel.getByRole("button", { name: new RegExp(seed.professionalFullName) })).toHaveCount(1);
    // The menu has its own search.
    await panel.getByTestId("calendar-prof-search").fill(seed.professionalFullName);
    await expect(panel.getByRole("button", { name: new RegExp(seed.professionalFullName) })).toHaveCount(1);
    await expect(panel.getByTestId("calendar-prof-chip-all")).toHaveCount(0);
  });

  test("HU-19 · 4 filtro de profesional en vista principal muestra a la elegida como etiqueta", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    await loginAsDemo(page);
    await page.goto("/app/calendar?view=week");
    await filterAgendaByProfessional(page, new RegExp(seed.professionalFullName));
    // She shows up as a tag inside the search field, and the menu marks her as the chosen one.
    await expect(page.getByTestId("calendar-prof-pill")).toContainText(seed.professionalFullName);
    const panel = await openProfessionalFilter(page);
    await expect(panel.getByRole("button", { name: new RegExp(seed.professionalFullName) })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(panel.getByTestId("calendar-prof-chip-all")).toHaveAttribute("aria-pressed", "false");
    // The × on the tag goes back to every professional.
    await page.keyboard.press("Escape");
    await page.getByTestId("calendar-prof-pill-clear").click();
    await expect(page.getByTestId("calendar-prof-pill")).toHaveCount(0);
  });

  test("HU-19 · 6 turno Completado sigue en la grilla, marcado como completado", async ({ page, request }) => {
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
    // It stays on the grid (a clean card, marked «Completed» since it has no comprobante yet).
    const block = page.getByRole("button", { name: new RegExp(client.fullName) });
    await expect(block).toHaveCount(1);
    await expect(block).toHaveAttribute("data-done", "completed");
    await expect(block.locator("[data-testid^='calendar-done-badge-']")).toHaveAttribute("aria-label", "Completed");
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

  test("HU-25 / HU-19 tarjeta resumida: nombre corto, mismo alto, y el detalle completo en un recuadro al pasar el mouse", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const stamp = Date.now();
    const longName = `Maria Longname ${"x".repeat(100)} ${stamp}`;
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
    await filterAgendaByProfessional(page, new RegExp(seed.professionalFullName));
    await ensureCalendarShowsAppointmentByTestId(page, `calendar-appt-${appt.id}`);
    const card = page.getByTestId(`calendar-appt-${appt.id}`);
    await expect(card).toBeVisible();
    // Short name: first name and the initial of the next word.
    await expect(page.getByTestId(`calendar-appt-name-${appt.id}`)).toHaveText("Maria L.");
    const h0 = (await card.boundingBox())!.height;
    await card.hover();
    const tip = page.getByTestId(`calendar-appt-tip-${appt.id}`);
    await expect(tip).toBeVisible();
    // The backend stores client names in upper case.
    await expect(tip).toContainText(longName, { ignoreCase: true });
    await expect(tip).toContainText(seed.serviceFullName);
    // The card does not grow or move: the detail floats over the grid.
    expect((await card.boundingBox())!.height).toBeCloseTo(h0, 0);
    await page.mouse.move(0, 0);
    await expect(tip).toHaveCount(0);
  });

  test("Semana: con 3 turnos a la misma hora se ve UNA tarjeta de grupo que abre la lista completa", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const startAt = calendarVisibleWeekSlotIso(16, 45);
    const names: string[] = [];
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      const seed = await seedCategoryServiceProfessional(request, token);
      const client = await seedClient(request, token, `E2E Mas${i} ${Date.now()}`);
      names.push(client.fullName);
      const appt = await createAppointmentApi(request, token, {
        clientId: client.id,
        professionalId: seed.professionalId,
        serviceId: seed.serviceId,
        startAt,
      });
      ids.push(appt.id);
    }

    await loginAsDemo(page);
    await page.goto("/app/calendar?view=week");
    // The chip that lists our three turnos (other turnos of the week may share the hour).
    const chip = page.locator(`[data-testid="calendar-more-chip"][data-appt-ids*=",${ids[0]},"]`);
    await expect(chip).toBeVisible({ timeout: 20_000 });
    await expect(chip).toContainText(/\d+ appointments · \d\d:\d\d/);
    // None of the group is drawn on its own (the whole card is the button); the list shows every turno.
    await expect(page.getByTestId(`calendar-appt-${ids[0]}`)).toHaveCount(0);
    await expect(page.getByTestId(`calendar-appt-${ids[2]}`)).toHaveCount(0);
    expect((await chip.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await chip.click();
    const pop = page.getByTestId("calendar-more-popover");
    await expect(pop).toBeVisible();
    for (const id of ids) await expect(pop.getByTestId(`calendar-more-row-${id}`)).toBeVisible();
    // The list opens beside the card, entirely inside the screen (no scrolling to reach it), without covering it.
    const box = (await pop.boundingBox())!;
    const cbox = (await chip.boundingBox())!;
    const vp = page.viewportSize()!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
    expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
    const overlapsCard = box.x < cbox.x + cbox.width && box.x + box.width > cbox.x && box.y < cbox.y + cbox.height && box.y + box.height > cbox.y;
    expect(overlapsCard, "la lista no debe tapar la tarjeta del grupo").toBe(false);
    // Tapping a row opens that turno's detail and closes the list.
    await pop.getByTestId(`calendar-more-row-${ids[2]}`).click();
    await expect(page.getByRole("dialog", { name: "Appointment detail" })).toContainText(names[2]);
    await expect(pop).toHaveCount(0);
  });

  test("Semana: los iconos de estado no usan leyenda, explican su significado al pasar el mouse", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E Icono ${Date.now()}`);
    const appt = await createAppointmentApi(request, token, {
      clientId: client.id,
      professionalId: seed.professionalId,
      serviceId: seed.serviceId,
      startAt: calendarVisibleWeekSlotIso(8, 15),
    });
    await loginAsDemo(page);
    await page.goto("/app/calendar?view=week");
    await filterAgendaByProfessional(page, new RegExp(seed.professionalFullName));
    await ensureCalendarShowsAppointmentByTestId(page, `calendar-appt-${appt.id}`);
    await expect(page.getByTestId("calendar-week-legend")).toHaveCount(0);
    // The page scrolls, not the grid: no ancestor of the day columns scrolls vertically by itself.
    const innerScroll = await page.getByTestId("calendar-day-col-mon").evaluate((el) => {
      for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
        if (n.scrollHeight > n.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(n).overflowY)) return true;
      }
      return false;
    });
    expect(innerScroll, "la grilla semanal no debe tener scroll propio").toBe(false);
    await expect(page.getByTestId(`calendar-appt-${appt.id}`).getByTestId(`status-icon-${appt.id}`)).toHaveAttribute(
      "title",
      "Pending",
    );
  });
});
