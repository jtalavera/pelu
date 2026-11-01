import { expect, test } from "@playwright/test";
import {
  createAppointmentApi,
  ensureCashSessionOpenApi,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { openDashboardMore } from "../fixtures/dashboard";

test.describe("HU-03 · Dashboard principal", () => {
  test("HU-03 · 1 resumen de turnos e ingresos del día en una línea", async ({ page }) => {
    await loginAsDemo(page);
    await expect(page.getByTestId("dashboard-summary-appointments")).toHaveText(/^\d+ appointments? today$/);
    // Revenue figures must use dot thousands separator with no decimals (e.g. "Gs. 1.234.567")
    await expect(page.getByTestId("dashboard-summary-collected")).toHaveText(
      /^Gs\. \d{1,3}(\.\d{3})* collected$/,
    );
    // Week and month totals no longer clutter Inicio: they live in Dashboards.
    await expect(page.getByText("Revenue this week", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Clients this month", { exact: true })).toHaveCount(0);
  });

  test("HU-03 · 2 accesos rápidos a calendario y nueva cita", async ({ page }) => {
    await loginAsDemo(page);
    await page.getByRole("link", { name: "View agenda →" }).click();
    await expect(page).toHaveURL(/\/app\/calendar/);
    await page.goto("/app");
    await page.getByRole("button", { name: "+ New appointment" }).first().click();
    await expect(page).toHaveURL(/\/app\/calendar/);
  });

  test("HU-03 · 4 estado vacío cuando no hay citas hoy", async ({ page }) => {
    // The shared demo tenant may already hold appointments for today (other specs): serve an empty
    // appointments list to exercise the empty state.
    await page.route("**/api/appointments?**", (route) => route.fulfill({ json: [] }));
    await loginAsDemo(page);
    await expect(page.getByText("No appointments today", { exact: true }).first()).toBeVisible();
  });

  test("HU-03 · 5 la facturación y los clientes del período se ven en Resumen", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/dashboards");
    // Resumen: the indicators follow the selected period (30 days by default).
    await expect(page.getByTestId("summary-kpi-revenue")).toHaveText(/^Gs\. \d{1,3}(\.\d{3})*$/);
    await expect(page.getByTestId("summary-kpi-clients")).toHaveText(/^\d+$/);
  });

  test("HU-03 · 6 «Más del día» está plegado y en el orden Fichas, Ocupación, Cumpleaños, Inactivos", async ({
    page,
  }) => {
    await loginAsDemo(page);
    const toggles = page.getByTestId("dashboard-more").getByRole("button");
    await expect(toggles).toHaveCount(4);
    await expect(toggles.nth(0)).toContainText("Today's service records");
    await expect(toggles.nth(1)).toContainText("Occupancy by professional");
    await expect(toggles.nth(2)).toContainText("Birthdays");
    await expect(toggles.nth(3)).toContainText("Inactive clients");
    for (let i = 0; i < 4; i++) await expect(toggles.nth(i)).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("dashboard-inactive-clients")).toHaveCount(0);

    await openDashboardMore(page, "occupancy");
    await page.getByTestId("dashboard-more-occupancy").click();
    await expect(page.getByTestId("dashboard-more-occupancy")).toHaveAttribute("aria-expanded", "false");
  });

  test("HU-03 · 7 cada turno muestra estado y botón «Charge», que abre la factura con cliente y servicio cargados", async ({
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
    slot.setHours(Math.min(23, slot.getHours() + 1), 0, 0, 0);
    await createAppointmentApi(request, token, {
      clientId: client.id,
      professionalId: seed.professionalId,
      serviceId: seed.serviceId,
      startAt: slot.toISOString(),
    });
    await loginAsDemo(page);
    const row = page.getByTestId("dashboard-appointment-row").filter({ hasText: new RegExp(clientName, "i") });
    await expect(row).toContainText("Pending");
    await row.getByTestId("dashboard-appointment-charge").click();
    await expect(page).toHaveURL(/\/app\/billing/);
    await expect(page.locator("#billing-client-search")).toHaveValue(new RegExp(clientName, "i"));
    await expect(page.getByText(seed.serviceFullName).first()).toBeVisible();
  });
});
