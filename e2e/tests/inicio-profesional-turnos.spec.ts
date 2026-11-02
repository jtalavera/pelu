import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import {
  apiGetJson,
  apiPostJson,
  createAppointmentApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
  type SeededSalon,
} from "../fixtures/api";
import { DEMO_PASSWORD, loginAs } from "../fixtures/auth";
import { PASSWORD, professionalWithAccess } from "../fixtures/commissions";

/**
 * Inicio de la profesional · «Mis turnos de hoy».
 * Ve solo sus turnos por atender; en cada uno crea o asigna la ficha (el turno pasa a En curso) o va a
 * la ficha. Nunca ve montos. Vale con clave y en el dispositivo compartido con PIN.
 */
test.describe.configure({ mode: "serial" });

function turnoSlot(): string {
  const slot = new Date();
  slot.setHours(Math.min(23, slot.getHours() + 1), 0, 0, 0);
  return slot.toISOString();
}

async function turnoFor(
  request: APIRequestContext,
  token: string,
  seed: SeededSalon,
  professionalId: number,
  clientId: number,
) {
  return createAppointmentApi(request, token, {
    clientId,
    professionalId,
    serviceId: seed.serviceId,
    startAt: turnoSlot(),
  });
}

async function expectFlow(page: Page, request: APIRequestContext, admin: string, own: { id: number }, ownName: string, otherName: string) {
  await expect(page.getByTestId("professional-home")).toBeVisible();
  const list = page.getByTestId("professional-today-appointments");
  const row = list.getByTestId("professional-appointment-row").filter({ hasText: ownName });
  await expect(row).toBeVisible({ timeout: 20_000 });
  // Someone else's turno is not on her list; nothing shows money.
  await expect(list.getByTestId("professional-appointment-row").filter({ hasText: otherName })).toHaveCount(0);
  expect((await list.innerText()).replace(/\s+/g, " ")).not.toMatch(/Gs\.|\d{1,3}(\.\d{3})+/);
  await expect(row).toContainText("Pending");

  // Create the ficha from the turno: it opens (no money), the turno goes En curso.
  await row.getByTestId("professional-appointment-ficha-create-or-assign").click();
  await page.getByTestId("appointment-ficha-create").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("service-record-appointment")).toBeVisible();
  await expect(dialog.getByTestId("service-record-total")).toHaveCount(0);
  await dialog.getByTestId("service-record-close").click();

  await expect(row).toContainText("In progress");
  await expect(row.getByTestId("professional-appointment-ficha-go")).toBeVisible();
  await expect(page.getByTestId("dashboard-service-record-card").filter({ hasText: ownName })).toBeVisible({
    timeout: 20_000,
  });
  const appt = await apiGetJson<{ status: string; serviceRecordId: number | null }>(
    request,
    admin,
    `/api/appointments/${own.id}`,
  );
  expect(appt.status).toBe("IN_PROGRESS");
  expect(appt.serviceRecordId).not.toBeNull();

  // «Ir a la ficha» opens it again.
  await row.getByTestId("professional-appointment-ficha-go").click();
  await expect(page.getByRole("dialog").getByTestId("service-record-appointment")).toBeVisible();
}

test.describe("Inicio de la profesional · turnos de hoy", () => {
  test("con clave: ve sus turnos, crea la ficha desde el turno y la abre sin montos", async ({ page, request }) => {
    const admin = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, admin);
    const pro = await professionalWithAccess(request, admin, `E2E IP Prof ${Date.now()}`);
    const ts = Date.now();
    const mine = await seedClient(request, admin, `E2E IP Propia ${ts}`);
    const other = await seedClient(request, admin, `E2E IP Ajena ${ts}`);
    const own = await turnoFor(request, admin, seed, pro.id, mine.id);
    await turnoFor(request, admin, seed, seed.professionalId, other.id);

    await loginAs(page, pro.email, PASSWORD);
    await expectFlow(page, request, admin, own, mine.fullName, other.fullName);
  });

  test("dispositivo compartido con PIN: la misma lista de turnos propios", async ({ page, request }) => {
    test.setTimeout(120_000);
    const admin = await loginAsDemoApi(request);
    const seed = await seedCategoryServiceProfessional(request, admin);
    const pin = String(100000 + Math.floor(Math.random() * 899999));
    const pro = await apiPostJson<{ id: number }>(request, admin, "/api/professionals", {
      fullName: `E2E IP Pin ${Date.now()}`,
      pin,
      email: null,
    });
    const device = await apiPostJson<{
      device: { id: number; name: string };
      deviceToken: string;
      tenantName: string;
    }>(request, admin, "/api/shared-devices", { name: `Tablet IP ${Date.now()}`, password: DEMO_PASSWORD });
    const ts = Date.now();
    const mine = await seedClient(request, admin, `E2E IP Pin Propia ${ts}`);
    const other = await seedClient(request, admin, `E2E IP Pin Ajena ${ts}`);
    const own = await turnoFor(request, admin, seed, pro.id, mine.id);
    await turnoFor(request, admin, seed, seed.professionalId, other.id);

    await page.addInitScript(
      ([key, value]) => {
        localStorage.setItem(key, value);
        localStorage.setItem("cursor_poc.i18n.language", "en");
        localStorage.setItem("femme.tour.seen.calendar", "true");
      },
      [
        "femme.sharedDevice",
        JSON.stringify({
          deviceId: device.device.id,
          name: device.device.name,
          tenantName: device.tenantName,
          token: device.deviceToken,
        }),
      ] as const,
    );
    await page.goto("/device");
    await page.getByTestId(`shared-device-professional-${pro.id}`).click();
    const pad = page.getByTestId("pin-pad");
    for (const d of pin) await pad.getByRole("button", { name: d, exact: true }).click();
    await page.getByTestId("pin-submit").click();
    await expect(page).toHaveURL(/\/app\/?$/);
    await expectFlow(page, request, admin, own, mine.fullName, other.fullName);
  });
});
