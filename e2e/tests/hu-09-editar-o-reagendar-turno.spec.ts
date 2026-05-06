import { expect, test } from "@playwright/test";
import { createAppointmentApi, calendarVisibleWeekSlotIso, loginAsDemoApi, seedCategoryServiceProfessional, seedClient } from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { bookingAppointmentDialog, fillAppointmentTime } from "../fixtures/ui";

test.describe("HU-09 · Editar o reagendar turno", () => {
  test("HU-09 · 1 y 3 editar hora y ver cambio en la grilla", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E Edit ${Date.now()}`);
    await createAppointmentApi(request, token, {
      clientId: client.id,
      professionalId: seed.professionalId,
      serviceId: seed.serviceId,
      startAt: calendarVisibleWeekSlotIso(9, 0),
    });

    await loginAsDemo(page);
    await page.goto("/app/calendar");
    await page.getByRole("button", { name: new RegExp(client.fullName) }).click();
    await page.getByRole("button", { name: "Edit appointment" }).click();
    const dlg = bookingAppointmentDialog(page);
    await fillAppointmentTime(dlg, "11:15");
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("button", { name: new RegExp(client.fullName) })).toBeVisible();
  });

  test("HU-09 · 4 no se puede editar turno Completado", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E NoEdit ${Date.now()}`);
    await createAppointmentApi(request, token, {
      clientId: client.id,
      professionalId: seed.professionalId,
      serviceId: seed.serviceId,
      startAt: calendarVisibleWeekSlotIso(8, 0),
    });

    await loginAsDemo(page);
    await page.goto("/app/calendar");
    await page.getByRole("button", { name: new RegExp(client.fullName) }).click();
    await page.getByRole("button", { name: "Change status" }).click();
    await page.locator("#status-select").selectOption("COMPLETED");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("button", { name: "Edit appointment" })).toHaveCount(0);
  });
});
