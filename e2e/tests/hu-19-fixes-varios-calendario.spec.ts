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

test.describe("HU-19 · Fixes varios del calendario", () => {
  test("filtro de profesionales con placeholder de búsqueda", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/calendar");
    await expect(page.getByPlaceholder("Type to filter…").first()).toBeVisible();
  });

  test("HU-19 · 4 filtro de profesional en vista principal reduce opciones", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await seedCategoryServiceProfessional(request, token);
    const suffix = Date.now();
    await apiPostJson(request, token, "/api/professionals", {
      fullName: `E2E Cal Filter ${suffix}`,
      phone: null,
      email: null,
      photoDataUrl: null,
    });

    const fullName = `E2E Cal Filter ${suffix}`;
    await loginAsDemo(page);
    await page.goto("/app/calendar");
    const cb = page.getByRole("combobox", { name: "Filter by professional" });
    await cb.click();
    await cb.fill(fullName);
    const list = page.getByRole("listbox", { name: "Filter by professional" });
    await expect(list.getByRole("button", { name: new RegExp(fullName) })).toHaveCount(1);
  });

  test("HU-19 · 6 turno Completado no aparece en la grilla", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E GridDone ${Date.now()}`);
    await createAppointmentApi(request, token, {
      clientId: client.id,
      professionalId: seed.professionalId,
      serviceId: seed.serviceId,
      startAt: tomorrowLocalIso(19, 0),
    });

    await loginAsDemo(page);
    await page.goto("/app/calendar");
    await page.getByRole("button", { name: new RegExp(client.fullName) }).click();
    await page.getByRole("button", { name: "Change status" }).click();
    await page.locator("#status-select").selectOption("COMPLETED");
    await page.getByRole("button", { name: "Save" }).click();
    await page
      .getByRole("dialog", { name: "Appointment detail" })
      .getByRole("button", { name: "Close" })
      .last()
      .click();
    await expect(page.getByRole("button", { name: new RegExp(client.fullName) })).toHaveCount(0);
  });
});
