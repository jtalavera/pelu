import { expect, test } from "@playwright/test";
import {
  createAppointmentApi,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

test.describe("HU-03 · Dashboard principal", () => {
  test("HU-03 · 1 resumen de turnos e ingresos del día en una línea", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/hoy");
    await expect(page.getByTestId("dashboard-summary-appointments")).toHaveText(/^\d+ appointments? today$/);
    // Revenue figures must use dot thousands separator with no decimals (e.g. "Gs. 1.234.567")
    await expect(page.getByTestId("dashboard-summary-collected")).toHaveText(
      /^Gs\. \d{1,3}(\.\d{3})* collected$/,
    );
    // Week and month totals no longer clutter Inicio: they live in Dashboards.
    await expect(page.getByText("Revenue this week", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Clients this month", { exact: true })).toHaveCount(0);
  });

  test("HU-03 · 2 accesos rápidos a calendario y nueva cita (el formulario abre en Inicio)", async ({ page }) => {
    await loginAsDemo(page);
    await page.getByRole("link", { name: "Open agenda →" }).click();
    await expect(page).toHaveURL(/\/app\/calendar/);
    await page.goto("/app/hoy");
    await page.getByRole("button", { name: "+ New appointment" }).first().click();
    // The booking form opens right on Inicio: no navigation to the Agenda.
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page).toHaveURL(/\/app\/hoy$/);
  });

  test("HU-03 · 4 estado vacío cuando no hay citas hoy", async ({ page }) => {
    // The shared demo tenant may already hold appointments for today (other specs): serve an empty
    // appointments list to exercise the empty state.
    await page.route("**/api/appointments?**", (route) => route.fulfill({ json: [] }));
    await loginAsDemo(page);
    await page.goto("/app/hoy");
    await expect(page.getByText("No appointments today", { exact: true }).first()).toBeVisible();
  });

  test("HU-03 · 5 la facturación y los clientes del período se ven en Reportes", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/dashboards");
    // Reportes: the indicators follow the selected period (30 days by default).
    await expect(page.getByTestId("summary-kpi-revenue")).toHaveText(/^Gs\. \d{1,3}(\.\d{3})*$/);
    await expect(page.getByTestId("summary-kpi-clients")).toHaveText(/^\d+$/);
  });

  test("HU-03 · 6 «Hoy» abre con su título y sin saludo ni «Más del día» (ocupación, cumpleaños e inactivos salieron: HU-78)", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await page.goto("/app/hoy");
    await expect(page.getByTestId("dashboard-title")).toHaveText("Today");
    await expect(page.getByTestId("dashboard-more")).toHaveCount(0);
    await expect(page.getByTestId("dashboard-more-occupancy")).toHaveCount(0);
    await expect(page.getByTestId("dashboard-more-birthdays")).toHaveCount(0);
    await expect(page.getByTestId("dashboard-more-inactive")).toHaveCount(0);
    // What stays: the lists of the day (the fichas are cards right on the screen).
    await expect(page.getByTestId("dashboard-today-records")).toBeVisible();
    await expect(page.getByTestId("dashboard-summary")).toBeVisible();
  });

  test("HU-03 · 7 cada turno muestra estado y «Crear o asignar ficha»; la ficha creada se cobra y abre la factura con cliente y servicio cargados", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await ensureCashSessionOpenApi(request, token);
    const seed = await seedCategoryServiceProfessional(request, token);
    const clientName = `E2E03 Cobrar ${Date.now()}`;
    const client = await seedClient(request, token, clientName);
    // Later today (local time), so the turno shows up in Inicio's list.
    const slot = new Date();
    slot.setTime(Date.now() + 5 * 60_000);
    slot.setSeconds(0, 0);
    await createAppointmentApi(request, token, {
      clientId: client.id,
      professionalId: seed.professionalId,
      serviceId: seed.serviceId,
      startAt: slot.toISOString(),
    });
    await loginAsDemo(page);
    await page.goto("/app/hoy");
    const row = page.getByTestId("dashboard-appointment-row").filter({ hasText: new RegExp(clientName, "i") });
    await expect(row).toContainText("Pending");
    await row.getByTestId("dashboard-appointment-ficha-create-or-assign").click();
    await page.getByTestId("appointment-ficha-create").click();
    await page.getByRole("dialog").getByTestId("service-record-generate-invoice").click();
    await expect(page).toHaveURL(/\/app\/billing/);
    await expect(page.locator("#billing-client-search")).toHaveValue(new RegExp(clientName, "i"));
    await expect(page.getByText(seed.serviceFullName).first()).toBeVisible();
  });
});
