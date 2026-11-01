import { expect, test } from "@playwright/test";
import {
  apiPostJson,
  createAppointmentApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
  tomorrowLocalIso,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

/**
 * Ajustes visuales:
 *  1. El "Estado" del pop-up de edición de servicio/producto se muestra como una pastilla con una
 *     aclaración cuando está activo, y como un aviso destacado con "Reactivar" cuando está inactivo.
 *  2. En la ficha de la cliente, pestaña Turnos, los próximos turnos se distinguen a simple vista
 *     de los anteriores (encabezado, acento y fondo distintos).
 */
test.describe("Ajustes · estado de servicio y turnos de la cliente", () => {
  test("1 · Editar servicio muestra el Estado como pastilla + aclaración, y un aviso con Reactivar si está inactivo", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const salon = await seedCategoryServiceProfessional(request, token);
    await loginAsDemo(page);
    const openEdit = async () => {
      await page.goto("/app/services");
      await page.getByPlaceholder("Search by name or category…").fill(salon.serviceFullName);
      await page.getByTestId(`svc-row-${salon.serviceId}`).first().click();
      const dialog = page.getByRole("dialog", { name: "Edit service" });
      await expect(dialog).toBeVisible();
      return dialog;
    };

    // Active: compact pill (no boxed row) with a one-line explanation, above the Name field.
    let dialog = await openEdit();
    let statusRow = dialog.getByTestId("catalog-item-status-row");
    await expect(statusRow).toHaveAttribute("data-status", "ACTIVE");
    await expect(statusRow).toContainText("Status:");
    await expect(statusRow).toContainText("Active");
    await expect(statusRow).toContainText("Available for new appointments and invoices.");
    const activeStyle = await statusRow.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, border: parseFloat(cs.borderTopWidth) };
    });
    expect(activeStyle.bg).toBe("rgba(0, 0, 0, 0)");
    expect(activeStyle.border).toBe(0);
    await expect(statusRow.getByRole("button", { name: "Reactivate" })).toHaveCount(0);
    const rowBox = (await statusRow.boundingBox())!;
    const nameBox = (await dialog.getByLabel("Name").boundingBox())!;
    expect(rowBox.y).toBeLessThan(nameBox.y);

    // Inactive: highlighted notice with the reason and a Reactivate button.
    await apiPostJson(request, token, `/api/services/${salon.serviceId}/deactivate`, {});
    dialog = await openEdit();
    statusRow = dialog.getByTestId("catalog-item-status-row");
    await expect(statusRow).toHaveAttribute("data-status", "INACTIVE");
    await expect(statusRow).toContainText("Inactive service: it does not appear in new appointments.");
    await expect(statusRow).toContainText("The category must be active to reactivate this service.");
    const inactiveBg = await statusRow.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(inactiveBg).not.toBe("rgba(0, 0, 0, 0)");
    const reactivate = statusRow.getByRole("button", { name: "Reactivate" });
    await expect(reactivate).toBeVisible();
    await reactivate.click();
    await expect(dialog.getByTestId("catalog-item-status-row")).toHaveAttribute("data-status", "ACTIVE");
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

    // Redesign: one compact list — the next appointment is highlighted, past ones follow as rows.
    const next = page.getByTestId("client-next-appointment");
    const pastItem = page.getByTestId("client-appointment-item");
    await expect(next).toHaveCount(1);
    await expect(next).toContainText(salon.serviceFullName);
    await expect(pastItem).toHaveCount(1);
    await expect(pastItem).toContainText("PAST SERVICE");
    const bg = (el: Element) => getComputedStyle(el).backgroundColor;
    expect(await next.evaluate(bg)).not.toBe(await pastItem.evaluate(bg));
  });
});
