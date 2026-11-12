import { expect, test } from "@playwright/test";
import {
  createAppointmentApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
  soonTodaySlot,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { filterAgendaByProfessional } from "../fixtures/ui";

/**
 * Calendario · buscador por cliente o servicio, en la barra de arriba (entre la fecha y Día | Semana):
 *  - filtra la lista del día por cliente o servicio, sin distinguir mayúsculas ni tildes;
 *  - resalta lo que coincide y muestra «N de M turnos»;
 *  - sin coincidencias, «Sin resultados» con un botón para borrar la búsqueda;
 *  - en la vista Semana, los turnos que no coinciden se atenúan (no desaparecen);
 *  - la × y el botón del estado vacío limpian la búsqueda.
 */
test.describe.configure({ mode: "serial" });

async function seedTwoTurnos(request: import("@playwright/test").APIRequestContext) {
  const token = await loginAsDemoApi(request);
  const tag = Date.now();
  const a = await seedCategoryServiceProfessional(request, token);
  const b = await seedCategoryServiceProfessional(request, token);
  // The accent in the name checks that «nunez» finds «Núñez».
  const clientA = await seedClient(request, token, `Núñez Buscar ${tag}`);
  const clientB = await seedClient(request, token, `Zapata Otro ${tag}`);
  const startAt = soonTodaySlot().toISOString();
  const turnoA = await createAppointmentApi(request, token, {
    clientId: clientA.id,
    professionalId: a.professionalId,
    serviceId: a.serviceId,
    startAt,
  });
  const turnoB = await createAppointmentApi(request, token, {
    clientId: clientB.id,
    professionalId: b.professionalId,
    serviceId: b.serviceId,
    startAt,
  });
  return { tag, a, b, turnoA, turnoB };
}

test.describe("Calendario · buscador", () => {
  test("filtra por cliente (sin tildes), resalta, cuenta y se limpia con la ×", async ({ page, request }) => {
    const { tag, turnoA, turnoB } = await seedTwoTurnos(request);
    await loginAsDemo(page);
    await page.goto("/app/calendar");

    const search = page.getByTestId("calendar-search");
    await expect(search).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId(`calendar-appt-${turnoA.id}`)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId(`calendar-appt-${turnoB.id}`)).toBeVisible();
    await expect(page.getByTestId("calendar-search-clear")).toHaveCount(0);

    // «Núñez» is found without accents and in any case.
    await search.fill(`nunez buscar ${tag}`);
    await expect(page.getByTestId(`calendar-appt-${turnoA.id}`)).toBeVisible();
    await expect(page.getByTestId(`calendar-appt-${turnoB.id}`)).toHaveCount(0);
    await expect(page.getByTestId(`calendar-appt-${turnoA.id}`).locator("mark")).toBeVisible();
    await expect(page.getByTestId("calendar-search-count")).toContainText(/^1 of \d+ appointments$/);

    // The × clears it and everything is back.
    await page.getByTestId("calendar-search-clear").click();
    await expect(search).toHaveValue("");
    await expect(page.getByTestId(`calendar-appt-${turnoB.id}`)).toBeVisible();
    await expect(page.getByTestId("calendar-search-count")).toHaveCount(0);
  });

  test("filtra por servicio y, sin coincidencias, muestra «Sin resultados» con el botón para borrar", async ({
    page,
    request,
  }) => {
    const { b, turnoA, turnoB } = await seedTwoTurnos(request);
    await loginAsDemo(page);
    await page.goto("/app/calendar");
    const search = page.getByTestId("calendar-search");
    await expect(page.getByTestId(`calendar-appt-${turnoA.id}`)).toBeVisible({ timeout: 20_000 });

    await search.fill(b.serviceFullName);
    await expect(page.getByTestId(`calendar-appt-${turnoB.id}`)).toBeVisible();
    await expect(page.getByTestId(`calendar-appt-${turnoA.id}`)).toHaveCount(0);

    await search.fill("zzzz-no-existe");
    const empty = page.getByTestId("calendar-search-empty");
    await expect(empty).toBeVisible();
    await expect(empty).toContainText("No results");
    await expect(empty).toContainText("zzzz-no-existe");
    await empty.getByRole("button", { name: "Clear search" }).click();
    await expect(search).toHaveValue("");
    await expect(page.getByTestId(`calendar-appt-${turnoA.id}`)).toBeVisible();
    await expect(page.getByTestId(`calendar-appt-${turnoB.id}`)).toBeVisible();
  });

  test("vista Semana: los turnos que no coinciden se atenúan y los que coinciden quedan normales", async ({
    page,
    request,
  }) => {
    const { tag, a, turnoA } = await seedTwoTurnos(request);
    await loginAsDemo(page);
    await page.goto("/app/calendar?view=week");
    const search = page.getByTestId("calendar-search");
    await expect(search).toBeVisible({ timeout: 20_000 });
    // Only her turno: other tests' turnos of the same hour would otherwise fold into «+N».
    await filterAgendaByProfessional(page, new RegExp(a.professionalFullName));
    const blockA = page.getByTestId(`calendar-appt-${turnoA.id}`);
    await expect(blockA).toBeAttached({ timeout: 20_000 });
    await expect(blockA).not.toHaveAttribute("data-dimmed", "true");

    // A search that matches her client leaves the block normal.
    await search.fill(`nunez buscar ${tag}`);
    await expect(blockA).not.toHaveAttribute("data-dimmed", "true");
    // One that matches someone else dims it (not removes: the grid keeps its shape).
    await search.fill(`zapata otro ${tag}`);
    await expect(blockA).toHaveAttribute("data-dimmed", "true");
    await expect(blockA).toBeAttached();
    // The card fades (0.15 s transition): wait for the final opacity instead of reading it mid-fade.
    await expect(blockA).toHaveCSS("opacity", "0.3");
    await expect(page.getByTestId("calendar-search-count")).toContainText(/this week$/);

    await page.getByTestId("calendar-search-clear").click();
    await expect(blockA).not.toHaveAttribute("data-dimmed", "true");
  });

  test("el buscador está en la con el botón de profesional al lado, debajo de la fecha y «Día | Semana»| Semana»", async ({ page, request }) => {
    await loginAsDemoApi(request);
    await loginAsDemo(page);
    await page.goto("/app/calendar");
    const search = page.getByTestId("calendar-search");
    await expect(search).toBeVisible({ timeout: 20_000 });
    const field = page.locator("[data-tour='calendar-search']");
    const [f, label, tabs, trigger] = await Promise.all([
      field.boundingBox(),
      page.getByTestId("calendar-range-label").boundingBox(),
      page.getByTestId("calendar-view-day").boundingBox(),
      page.getByTestId("calendar-prof-trigger").boundingBox(),
    ]);
    // Search field and professional button: two controls of the same height, side by side, below the date
    // row and the Día | Semana switch (there is no separate row of professional chips).
    expect(f!.y).toBeGreaterThan(label!.y + label!.height - 2);
    expect(f!.y).toBeGreaterThan(tabs!.y + tabs!.height - 2);
    expect(trigger!.x).toBeGreaterThanOrEqual(f!.x + f!.width);
    const btn = await page.locator("[data-tour='calendar-prof-filter'] > div").boundingBox();
    expect(Math.abs(btn!.height - f!.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(btn!.y - f!.y)).toBeLessThanOrEqual(1);
    expect(f!.height).toBeGreaterThanOrEqual(44);
    await expect(page.locator("[data-testid^='calendar-prof-chip-']")).toHaveCount(0);
  });
});
