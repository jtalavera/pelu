import { expect, test } from "@playwright/test";
import { createAppointmentApi, loginAsDemoApi, seedCategoryServiceProfessional, seedClient, tomorrowLocalIso } from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

test.describe("HU-08 · Cambiar estado de un turno", () => {
  test("HU-08 · 1 y 2 cambiar estado desde detalle a Completado", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E St ${Date.now()}`);
    await createAppointmentApi(request, token, {
      clientId: client.id,
      professionalId: seed.professionalId,
      serviceId: seed.serviceId,
      startAt: tomorrowLocalIso(10, 0),
    });

    await loginAsDemo(page);
    await page.goto("/app/calendar");
    await page.getByRole("button", { name: new RegExp(client.fullName) }).click();
    await page.getByRole("button", { name: "Change status" }).click();
    await page.locator("#status-select").selectOption("COMPLETED");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Completed", { exact: true })).toBeVisible();
  });

  test("HU-08 · 3 cancelación con razón", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E Can ${Date.now()}`);
    await createAppointmentApi(request, token, {
      clientId: client.id,
      professionalId: seed.professionalId,
      serviceId: seed.serviceId,
      startAt: tomorrowLocalIso(18, 0),
    });

    await loginAsDemo(page);
    await page.goto("/app/calendar");
    await page.getByRole("button", { name: new RegExp(client.fullName) }).click();
    await page.getByRole("button", { name: "Change status" }).click();
    await page.locator("#status-select").selectOption("CANCELLED");
    await page.locator("#cancel-reason").fill("E2E: client cancelled");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
    await expect(page.getByText("E2E: client cancelled", { exact: true })).toBeVisible();
  });

  test("HU-08 · 4 Completado se distingue en el detalle", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E Cmp ${Date.now()}`);
    await createAppointmentApi(request, token, {
      clientId: client.id,
      professionalId: seed.professionalId,
      serviceId: seed.serviceId,
      startAt: tomorrowLocalIso(11, 30),
    });

    await loginAsDemo(page);
    await page.goto("/app/calendar");
    await page.getByRole("button", { name: new RegExp(client.fullName) }).click();
    await page.getByRole("button", { name: "Change status" }).click();
    await page.locator("#status-select").selectOption("COMPLETED");
    await page.getByRole("button", { name: "Save" }).click();
    const badge = page.locator("span").filter({ hasText: /^Completed$/ });
    await expect(badge.first()).toBeVisible();
  });
});
