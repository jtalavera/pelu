import { expect, test } from "@playwright/test";
import {
  createAppointmentApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
  soonTodaySlot,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

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
    const { tag, turnoA, turnoB } = await seedTwoTurnos(request);
    await loginAsDemo(page);
    await page.goto("/app/calendar?view=week");
    const search = page.getByTestId("calendar-search");
    await expect(search).toBeVisible({ timeout: 20_000 });
    const blockA = page.getByTestId(`calendar-appt-${turnoA.id}`);
    const blockB = page.getByTestId(`calendar-appt-${turnoB.id}`);
    await expect(blockA).toBeAttached({ timeout: 20_000 });
    await expect(blockB).toBeAttached();
    await expect(blockA).not.toHaveAttribute("data-dimmed", "true");

    await search.fill(`nunez buscar ${tag}`);
    await expect(blockB).toHaveAttribute("data-dimmed", "true");
    await expect(blockA).not.toHaveAttribute("data-dimmed", "true");
    // Dimmed, not removed: the grid keeps its shape.
    await expect(blockB).toBeAttached();
    expect(await blockB.evaluate((el) => getComputedStyle(el).opacity)).toBe("0.3");
    await expect(page.getByTestId("calendar-search-count")).toContainText(/this week$/);

    await page.getByTestId("calendar-search-clear").click();
    await expect(blockB).not.toHaveAttribute("data-dimmed", "true");
  });

  test("el buscador está en la barra de arriba, entre la fecha y «Día | Semana»", async ({ page, request }) => {
    await loginAsDemoApi(request);
    await loginAsDemo(page);
    await page.goto("/app/calendar");
    const search = page.getByTestId("calendar-search");
    await expect(search).toBeVisible({ timeout: 20_000 });
    const [s, label, tabs] = await Promise.all([
      search.boundingBox(),
      page.getByTestId("calendar-range-label").boundingBox(),
      page.getByTestId("calendar-view-day").boundingBox(),
    ]);
    // Same row as the date and the Día | Semana switch, between them.
    expect(Math.abs(s!.y + s!.height / 2 - (label!.y + label!.height / 2))).toBeLessThan(24);
    expect(s!.x).toBeGreaterThan(label!.x);
    expect(s!.x + s!.width).toBeLessThan(tabs!.x + 2);
    expect(Math.round(s!.height)).toBe(44);
  });
});
