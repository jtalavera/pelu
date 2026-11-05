import { expect, test } from "@playwright/test";
import {
  apiGetJson,
  createAppointmentApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

/**
 * Inicio · «Turnos de hoy»: el turno se abre en su detalle SIN salir de Inicio (antes llevaba al
 * Calendario) y se puede avanzar de estado, cancelar con motivo y editar desde ahí.
 */
test.describe.configure({ mode: "serial" });

async function seedTodayTurno(request: import("@playwright/test").APIRequestContext) {
  const token = await loginAsDemoApi(request);
  const seed = await seedCategoryServiceProfessional(request, token);
  const clientName = `E2E Detalle ${Date.now()}`;
  const client = await seedClient(request, token, clientName);
  const slot = new Date(Date.now() + 5 * 60_000);
  slot.setSeconds(0, 0);
  const turno = await createAppointmentApi(request, token, {
    clientId: client.id,
    professionalId: seed.professionalId,
    serviceId: seed.serviceId,
    startAt: slot.toISOString(),
  });
  return { token, clientName, turnoId: turno.id };
}

test.describe("Inicio · detalle del turno en el lugar", () => {
  test("tocar el turno abre el detalle en Inicio y «Confirmar» cambia el estado sin navegar", async ({
    page,
    request,
  }) => {
    const { token, clientName, turnoId } = await seedTodayTurno(request);
    await loginAsDemo(page);
    const row = page.getByTestId("dashboard-appointment-row").filter({ hasText: clientName });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.locator("button").first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(clientName);
    await expect(page).toHaveURL(/\/app\/?$/);

    await dialog.getByTestId("calendar-next-step").click(); // Confirmar
    await expect(dialog.getByTestId("calendar-next-step")).toHaveText("Start", { timeout: 15_000 });
    await expect(page).toHaveURL(/\/app\/?$/);
    expect((await apiGetJson<{ status: string }>(request, token, `/api/appointments/${turnoId}`)).status).toBe(
      "CONFIRMED",
    );

    await dialog.getByRole("button", { name: "Close" }).first().click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(row).toContainText("Confirmed");
  });

  test("cancelar desde el detalle pide el motivo y el turno sale de la lista", async ({ page, request }) => {
    const { token, clientName, turnoId } = await seedTodayTurno(request);
    await loginAsDemo(page);
    const row = page.getByTestId("dashboard-appointment-row").filter({ hasText: clientName });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.locator("button").first().click();

    await page.getByTestId("calendar-more-actions").click();
    await page.getByTestId("calendar-action-cancel").click();
    await page.locator("#cancel-reason").fill("E2E motivo");
    await page.getByTestId("calendar-cancel-confirm").click();

    await expect(page).toHaveURL(/\/app\/?$/);
    await expect
      .poll(async () => (await apiGetJson<{ status: string; cancelReason: string | null }>(request, token, `/api/appointments/${turnoId}`)).cancelReason)
      .toBe("E2E motivo");
  });
});
