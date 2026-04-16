import { expect, test } from "@playwright/test";
import {
  createAppointmentApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
  tomorrowLocalIso,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { localDatePlusDays, pickSearchableOption } from "../fixtures/ui";

function rxExact(s: string): RegExp {
  return new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

test.describe("HU-07 · Agendar un turno", () => {
  test("abre el diálogo de nuevo turno", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/calendar");
    await page.getByRole("button", { name: "New appointment" }).first().click();
    await expect(page.getByRole("heading", { name: "New appointment" })).toBeVisible();
  });

  test("HU-07 · 1 crear turno con cliente, servicio y profesional", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E Book ${Date.now()}`);

    await loginAsDemo(page);
    await page.goto("/app/calendar");
    await page.getByRole("button", { name: "New appointment" }).first().click();
    const dlg = page.getByRole("dialog");
    const day = localDatePlusDays(1);
    await dlg.locator("#form-date").fill(day);
    await dlg.locator("#form-time").fill("14:30");
    await pickSearchableOption(
      page,
      "Professional",
      seed.professionalFullName.slice(0, 9),
      rxExact(seed.professionalFullName),
    );
    await pickSearchableOption(
      page,
      "Service",
      seed.serviceFullName.slice(0, 9),
      rxExact(seed.serviceFullName),
    );
    await pickSearchableOption(page, "Client", client.fullName, new RegExp(client.fullName));
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("button", { name: new RegExp(client.fullName) })).toBeVisible();
  });

  test("HU-07 · 4 estado inicial Pendiente en el detalle", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E Pend ${Date.now()}`);
    await createAppointmentApi(request, token, {
      clientId: client.id,
      professionalId: seed.professionalId,
      serviceId: seed.serviceId,
      startAt: tomorrowLocalIso(15, 0),
    });

    await loginAsDemo(page);
    await page.goto("/app/calendar");
    await page.getByRole("button", { name: new RegExp(client.fullName) }).click();
    await expect(page.getByText("Pending", { exact: true })).toBeVisible();
  });

  test("HU-07 · 2 sin solapamiento: segundo turno mismo slot muestra error", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E A ${Date.now()}`);
    const startAt = tomorrowLocalIso(16, 0);
    await createAppointmentApi(request, token, {
      clientId: client.id,
      professionalId: seed.professionalId,
      serviceId: seed.serviceId,
      startAt,
    });

    await loginAsDemo(page);
    await page.goto("/app/calendar");
    await page.getByRole("button", { name: "New appointment" }).first().click();
    const dlg = page.getByRole("dialog");
    const day = localDatePlusDays(1);
    await dlg.locator("#form-date").fill(day);
    await dlg.locator("#form-time").fill("16:00");
    await pickSearchableOption(
      page,
      "Professional",
      seed.professionalFullName.slice(0, 9),
      rxExact(seed.professionalFullName),
    );
    await pickSearchableOption(
      page,
      "Service",
      seed.serviceFullName.slice(0, 9),
      rxExact(seed.serviceFullName),
    );
    const [saveRes] = await Promise.all([
      page.waitForResponse(
        (r) =>
          /\/api\/appointments\/?$/.test(new URL(r.url()).pathname) &&
          r.request().method() === "POST",
        { timeout: 15_000 },
      ),
      dlg.getByRole("button", { name: "Save" }).click(),
    ]);
    expect(saveRes.status()).toBe(409);
    await expect(dlg.getByRole("alert").first()).toBeVisible();
    await expect(
      dlg.getByText(/This time slot is already taken for the selected professional/),
    ).toBeVisible();
  });

  test("HU-07 · 3 tras crear, el turno aparece en la grilla", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, token);
    const client = await seedClient(request, token, `E2E Grid ${Date.now()}`);

    await loginAsDemo(page);
    await page.goto("/app/calendar");
    await page.getByRole("button", { name: "New appointment" }).first().click();
    const dlg = page.getByRole("dialog");
    const day = localDatePlusDays(1);
    await dlg.locator("#form-date").fill(day);
    await dlg.locator("#form-time").fill("17:00");
    await pickSearchableOption(
      page,
      "Professional",
      seed.professionalFullName.slice(0, 9),
      rxExact(seed.professionalFullName),
    );
    await pickSearchableOption(
      page,
      "Service",
      seed.serviceFullName.slice(0, 9),
      rxExact(seed.serviceFullName),
    );
    await pickSearchableOption(page, "Client", client.fullName, new RegExp(client.fullName));
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("button", { name: new RegExp(client.fullName) })).toBeVisible();
  });
});
