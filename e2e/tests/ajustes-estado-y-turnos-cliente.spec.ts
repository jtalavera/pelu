import { expect, test } from "@playwright/test";
import {
  createAppointmentApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
  tomorrowLocalIso,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

/**
 * Ajustes visuales:
 *  1. La línea de "Estado" del pop-up de edición de servicio/producto tiene alto y padding
 *     cómodos (antes quedaba muy angosta por una clase Tailwind rota).
 *  2. En la ficha de la cliente, pestaña Turnos, los próximos turnos se distinguen a simple vista
 *     de los anteriores (encabezado, acento y fondo distintos).
 */
test.describe("Ajustes · estado de servicio y turnos de la cliente", () => {
  test("1 · la línea de Estado en Editar servicio tiene alto y padding suficientes", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const salon = await seedCategoryServiceProfessional(request, token);
    await loginAsDemo(page);
    await page.goto("/app/services");
    await page.getByPlaceholder("Search by name or category…").fill(salon.serviceFullName);
    await page.getByTestId(`svc-row-${salon.serviceId}`).first().click();
    const dialog = page.getByRole("dialog", { name: "Edit service" });
    await expect(dialog).toBeVisible();

    const statusRow = dialog.getByTestId("catalog-item-status-row");
    await expect(statusRow).toContainText("Status");
    await expect(statusRow).toContainText("Active");
    const box = (await statusRow.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(60);
    const padding = await statusRow.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        top: parseFloat(cs.paddingTop),
        left: parseFloat(cs.paddingLeft),
      };
    });
    expect(padding.top).toBeGreaterThanOrEqual(12);
    expect(padding.left).toBeGreaterThanOrEqual(16);
  });

  test("2 · próximos y anteriores se distinguen visualmente en la pestaña Turnos", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const salon = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E Turnos Look ${Date.now()}`);
    await createAppointmentApi(request, token, {
      clientId: client.id,
      professionalId: salon.professionalId,
      serviceId: salon.serviceId,
      startAt: tomorrowLocalIso(11, 0),
    });

    // The API rejects appointments in the past, so the past list is served by a route stub.
    const past = new Date();
    past.setDate(past.getDate() - 10);
    await page.route("**/api/appointments/history?**", (route) =>
      route.fulfill({
        json: {
          content: [
            {
              id: 999_001,
              clientId: client.id,
              clientName: "E2E",
              professionalId: salon.professionalId,
              professionalName: salon.professionalFullName,
              serviceId: salon.serviceId,
              serviceName: "PAST SERVICE",
              durationMinutes: 60,
              startAt: past.toISOString(),
              endAt: new Date(past.getTime() + 3_600_000).toISOString(),
              status: "COMPLETED",
              cancelReason: null,
            },
          ],
          page: 0,
          size: 10,
          totalElements: 1,
          totalPages: 1,
        },
      }),
    );

    await loginAsDemo(page);
    await page.goto(`/app/clients/${client.id}?tab=appointments`);

    const upcoming = page.getByTestId("client-appts-upcoming");
    const previous = page.getByTestId("client-appts-past");
    await expect(upcoming.getByRole("heading", { name: /Upcoming\s*1/ })).toBeVisible();
    await expect(previous.getByRole("heading", { name: /Past\s*1/ })).toBeVisible();

    const upcomingItem = upcoming.getByTestId("client-appt-item");
    const pastItem = previous.getByTestId("client-appt-item");
    await expect(upcomingItem).toHaveCount(1);
    await expect(upcomingItem).toHaveAttribute("data-variant", "upcoming");
    await expect(upcomingItem).toContainText(salon.serviceFullName);
    await expect(pastItem).toHaveCount(1);
    await expect(pastItem).toHaveAttribute("data-variant", "past");
    await expect(pastItem).toContainText("PAST SERVICE");

    const style = (el: Element) => {
      const cs = getComputedStyle(el);
      return {
        bg: cs.backgroundColor,
        accent: cs.borderLeftColor,
        accentWidth: parseFloat(cs.borderLeftWidth),
      };
    };
    const up = await upcomingItem.evaluate(style);
    const pa = await pastItem.evaluate(style);
    expect(up.accentWidth).toBeGreaterThanOrEqual(4);
    expect(pa.accentWidth).toBeGreaterThanOrEqual(4);
    expect(up.bg).not.toBe(pa.bg);
    expect(up.accent).not.toBe(pa.accent);

    // The two section headings use different colors too.
    const headColor = (el: Element) => getComputedStyle(el).color;
    const upHead = await upcoming.getByRole("heading").evaluate(headColor);
    const paHead = await previous.getByRole("heading").evaluate(headColor);
    expect(upHead).not.toBe(paHead);
  });
});
