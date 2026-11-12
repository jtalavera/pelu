import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  apiGetJson,
  apiPostJson,
  createAppointmentApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
  calendarVisibleWeekSlotIso,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { bookingAppointmentDialog, completeAppointmentFromDetail, ensureCalendarShowsAppointmentByTestId, ensureCalendarShowsClientCard, ensureCalendarShowsLocator, filterAgendaByProfessional, openProfessionalFilter } from "../fixtures/ui";

/**
 * A visible-week hour slot that no other turno (of any spec) overlaps, so a test that needs exactly
 * N turnos at one hour is not folded into a bigger «+N» group by turnos other specs left behind.
 */
async function freeWeekSlotIso(request: APIRequestContext, token: string): Promise<string> {
  for (const hour of [20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8]) {
    const iso = calendarVisibleWeekSlotIso(hour, 0);
    const start = new Date(iso).getTime();
    const end = start + 60 * 60_000;
    const around = await apiGetJson<Array<{ startAt: string; endAt: string; status: string }>>(
      request,
      token,
      `/api/appointments?from=${encodeURIComponent(new Date(start - 8 * 3600_000).toISOString())}&to=${encodeURIComponent(new Date(end + 8 * 3600_000).toISOString())}`,
    );
    const busy = around.some(
      (a) => a.status !== "CANCELLED" && new Date(a.startAt).getTime() < end && new Date(a.endAt).getTime() > start,
    );
    if (!busy) return iso;
  }
  throw new Error("no free hour left in the visible week");
}

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
    // Only this professional's turnos: turnos other specs leave at the same hour would fold ours into «+N».
    await filterAgendaByProfessional(page, new RegExp(seed.professionalFullName));
    // On a Sunday evening the slot lands in next week: navigate to it instead of assuming this week.
    await ensureCalendarShowsClientCard(page, new RegExp(client.fullName));
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
    // On a Sunday afternoon the slot lands in next week: navigate to it instead of assuming this week.
    await ensureCalendarShowsLocator(page, () => chip);
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

  test("Semana: la lista del grupo sigue a su tarjeta al scrollear la pantalla y se cierra cuando la tarjeta sale de la vista", async ({
    page,
    request,
  }) => {
    // Short screen, so the week scrolls (the page scrolls, not the grid).
    await page.setViewportSize({ width: 1280, height: 520 });
    const token = await loginAsDemoApi(request);
    const startAt = calendarVisibleWeekSlotIso(17, 0);
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      const seed = await seedCategoryServiceProfessional(request, token);
      const client = await seedClient(request, token, `E2E Sigue${i} ${Date.now()}`);
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
    const chip = page.locator(`[data-testid="calendar-more-chip"][data-appt-ids*=",${ids[0]},"]`);
    // On a Sunday afternoon the slot lands in next week: navigate to it instead of assuming this week.
    await ensureCalendarShowsLocator(page, () => chip);
    await chip.scrollIntoViewIfNeeded();
    await chip.click();
    const pop = page.getByTestId("calendar-more-popover");
    await expect(pop).toBeVisible();
    // The browser's own scroll right after the click must not close the list.
    await page.waitForTimeout(300);
    await expect(pop).toBeVisible();

    // A small scroll: the list stays open and moves with its card (same offset from it).
    const offset = async () => {
      const [p, c] = [(await pop.boundingBox())!, (await chip.boundingBox())!];
      return { dx: Math.round(p.x - c.x), chipY: c.y };
    };
    const before = await offset();
    // Scroll the page a little, in whichever direction has room.
    await page.evaluate(() => window.scrollBy(0, window.scrollY >= 60 ? -60 : 60));
    await expect.poll(async () => (await offset()).chipY).not.toBeCloseTo(before.chipY, 0);
    await expect(pop).toBeVisible();
    const after = await offset();
    // Still beside the card (the vertical offset may change: the list is kept inside the screen).
    expect(Math.abs(after.dx - before.dx)).toBeLessThanOrEqual(2);
    const moved = (await pop.boundingBox())!;
    expect(moved.y).toBeGreaterThanOrEqual(0);
    expect(moved.y + moved.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    // The list floats above the neighbouring day columns: it is what is under its own center.
    const pbox = (await pop.boundingBox())!;
    const onTop = await page.evaluate(
      ([x, y]) => !!document.elementFromPoint(x, y)?.closest("[data-testid='calendar-more-popover']"),
      [pbox.x + pbox.width / 2, pbox.y + pbox.height / 2],
    );
    expect(onTop, "la lista no debe quedar debajo de otra columna").toBe(true);

    // Scrolling the card out of the screen closes the list.
    const offScreen = await page.evaluate((sel) => {
      const out = () => {
        const r = document.querySelector(sel)!.getBoundingClientRect();
        return r.bottom < 0 || r.top > window.innerHeight;
      };
      window.scrollTo(0, 0);
      if (!out()) window.scrollTo(0, document.documentElement.scrollHeight);
      return out();
    }, `[data-testid="calendar-more-chip"][data-appt-ids*=",${ids[0]},"]`);
    expect(offScreen, "la tarjeta del grupo debe poder salir de la pantalla").toBe(true);
    await expect(pop).toHaveCount(0);
  });

  test("Semana: con 2 turnos lado a lado el nombre va en su propia línea y se ve entero en cada tarjeta angosta; el recuadro de detalle queda por encima de las columnas vecinas", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const startAt = await freeWeekSlotIso(request, token);
    const ids: number[] = [];
    for (let i = 0; i < 2; i++) {
      const seed = await seedCategoryServiceProfessional(request, token);
      const client = await seedClient(request, token, `Ana${i} Angosta ${Date.now()}`);
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
    await ensureCalendarShowsAppointmentByTestId(page, `calendar-appt-${ids[0]}`);
    for (const [i, id] of ids.entries()) {
      const card = page.getByTestId(`calendar-appt-${id}`);
      await expect(card).toBeVisible({ timeout: 20_000 });
      const name = page.getByTestId(`calendar-appt-name-${id}`);
      await expect(name).toHaveText(`Ana${i} A.`, { ignoreCase: true });
      await expect(name).toBeVisible();
      // Half-width card: the name sits below the time row, using the card's width, never squeezed to nothing.
      const [nb, cb] = [(await name.boundingBox())!, (await card.boundingBox())!];
      expect(nb.width).toBeGreaterThan(10);
      expect(nb.y).toBeGreaterThan(cb.y + 8);
      const fits = await name.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
      expect(fits, "el nombre corto entra completo en la tarjeta angosta").toBe(true);
    }
    const [a, b] = [(await page.getByTestId(`calendar-appt-${ids[0]}`).boundingBox())!, (await page.getByTestId(`calendar-appt-${ids[1]}`).boundingBox())!];
    expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
    expect(a.x + a.width).toBeLessThanOrEqual(b.x + 1);

    // The hover box is wider than the day column: wherever it spills over the next day, it stays on top.
    const card = page.getByTestId(`calendar-appt-${ids[0]}`);
    await card.scrollIntoViewIfNeeded();
    await card.hover();
    const tip = page.getByTestId(`calendar-appt-tip-${ids[0]}`);
    await expect(tip).toBeVisible();
    await tip.evaluate((el) => el.scrollIntoView({ block: "nearest" }));
    const tb = (await tip.boundingBox())!;
    const hits = await page.evaluate(
      ([x, y, w]) =>
        [x + 6, x + w / 2, x + w - 6].map((px) => {
          // The box ignores the mouse (pointer-events: none); let elementFromPoint see it to test what is painted on top.
          (document.querySelector("[role='tooltip']") as HTMLElement).style.pointerEvents = "auto";
          const e = document.elementFromPoint(px, y);
          return e?.closest("[role='tooltip']") ? "tooltip" : `${e?.tagName}[${e?.getAttribute("data-testid") ?? ""}]`;
        }),
      [tb.x, tb.y + tb.height / 2, tb.width],
    );
    expect(hits, "el recuadro de detalle no debe quedar tapado por la columna vecina").toEqual(["tooltip", "tooltip", "tooltip"]);
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
