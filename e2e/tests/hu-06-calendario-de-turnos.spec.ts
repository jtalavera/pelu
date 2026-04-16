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
import { pickSearchableOption } from "../fixtures/ui";

test.describe("HU-06 · Calendario de turnos", () => {
  test("HU-06 · 3 navegación semanas actualiza el rango mostrado", async ({ page }) => {
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
    const startAt = tomorrowLocalIso(11, 0);
    await createAppointmentApi(request, token, {
      clientId: client.id,
      professionalId: seed.professionalId,
      serviceId: seed.serviceId,
      startAt,
    });

    await loginAsDemo(page);
    await page.goto("/app/calendar");

    await expect(page.getByRole("button", { name: new RegExp(client.fullName) })).toBeVisible();
    await expect(page.getByText(/E2E Svc /)).toBeVisible();
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
      startAt: tomorrowLocalIso(12, 0),
    });

    await loginAsDemo(page);
    await page.goto("/app/calendar");
    await pickSearchableOption(page, "Filter by professional", "E2E Prof B", /E2E Prof B/);
    await expect(page.getByRole("button", { name: client.fullName, exact: false })).toHaveCount(0);
    await pickSearchableOption(page, "Filter by professional", "All", /All professionals/);
    await expect(page.getByRole("button", { name: client.fullName, exact: false })).toBeVisible();
  });

  test("HU-06 · 5 clic en tarjeta abre detalle", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E Det ${Date.now()}`);
    await createAppointmentApi(request, token, {
      clientId: client.id,
      professionalId: seed.professionalId,
      serviceId: seed.serviceId,
      startAt: tomorrowLocalIso(13, 0),
    });

    await loginAsDemo(page);
    await page.goto("/app/calendar");
    await page.getByRole("button", { name: client.fullName, exact: false }).click();
    await expect(page.getByRole("heading", { name: "Appointment detail" })).toBeVisible();
    await expect(page.getByText("Client", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("dialog", { name: "Appointment detail" }).getByText(client.fullName, { exact: true }),
    ).toBeVisible();
  });
});
