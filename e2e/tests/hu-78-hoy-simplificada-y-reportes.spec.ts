import { expect, test } from "@playwright/test";
import { createAppointmentApi, seedClient } from "../fixtures/api";
import { loginAdminUi, provisionCommissionWorld, type CommissionWorld } from "../fixtures/commissions";

/**
 * HU-78 · «Hoy» sin la bienvenida y «Reportes» con el detalle abierto: Hoy pierde el saludo, la
 * alerta fiscal y «Más del día»; Ocupación por profesional y Clientes inactivos pasan a Reportes,
 * donde «Ver más detalle» se abre solo; Cumpleaños deja de verse en el Inicio. Mundo propio por test.
 */
let w: CommissionWorld;

test.beforeEach(async ({ request }) => {
  w = await provisionCommissionWorld(request, "Hoy simple", { commissionsEnabled: false });
});

test("AC1-2 · «Hoy» abre con su título y sin saludo, sin alerta fiscal y sin «Más del día»", async ({ page }) => {
  test.setTimeout(60_000);
  // Even when the server sends a fiscal alert, «Hoy» does not show it (it lives in «Resumen»).
  await page.route("**/api/dashboard", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.fiscalAlerts = [{ severity: "warning", messageKey: "sifenVoidingPending", message: "pending voidings" }];
    await route.fulfill({ response: res, json: body });
  });
  await loginAdminUi(page, w);
  await page.goto("/app/hoy");
  await expect(page.getByTestId("dashboard-title")).toHaveText("Today", { timeout: 30_000 });
  await expect(page.locator('[data-tour="dashboard-greeting"]')).toHaveCount(0);
  await expect(page.getByText(/good (morning|afternoon|evening)/i)).toHaveCount(0);
  await expect(page.getByText(/voidings? .*SIFEN|inutilizaci/i)).toHaveCount(0);
  await expect(page.getByTestId("dashboard-more")).toHaveCount(0);
  for (const name of ["Occupancy by professional", "Birthdays", "Inactive clients"]) {
    await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  }
  // What stays: the actions, the summary line and the lists of the day.
  await expect(page.getByTestId("dashboard-new-service-record")).toBeVisible();
  await expect(page.getByTestId("dashboard-summary")).toBeVisible();
  await expect(page.getByTestId("dashboard-today-records")).toBeVisible();
});

test("AC3 · «Reportes» abre con «Ver más detalle» abierto y se puede plegar", async ({ page }) => {
  test.setTimeout(60_000);
  await loginAdminUi(page, w);
  await page.goto("/app/dashboards");
  const toggle = page.getByTestId("summary-more-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "true", { timeout: 30_000 });
  await expect(page.getByTestId("summary-more")).toBeVisible();
  await expect(page.getByTestId("summary-occupancy")).toBeVisible();
  await expect(page.getByTestId("summary-inactive-clients")).toBeVisible();

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("summary-occupancy")).toHaveCount(0);
  await expect(page.getByTestId("summary-inactive-clients")).toHaveCount(0);
  await toggle.click();
  await expect(page.getByTestId("summary-occupancy")).toBeVisible();
});

test("AC4 · «Ocupación por profesional» cuenta los turnos de hoy de cada profesional", async ({ page, request }) => {
  test.setTimeout(90_000);
  const client = await seedClient(request, w.adminToken, `Hoy simple ${Date.now()}`);
  const slot = new Date(Date.now() + 5 * 60_000);
  slot.setSeconds(0, 0);
  for (let i = 0; i < 2; i++) {
    await createAppointmentApi(request, w.adminToken, {
      clientId: client.id,
      professionalId: w.ana.id,
      serviceId: w.service.id,
      startAt: new Date(slot.getTime() + i * 60 * 60_000).toISOString(),
    });
  }
  await loginAdminUi(page, w);
  await page.goto("/app/dashboards");
  const card = page.getByTestId("summary-occupancy");
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText(/today's appointments/i);
  const row = card.getByTestId("summary-occupancy-row").filter({ hasText: new RegExp(w.ana.name, "i") });
  await expect(row).toBeVisible();
  await expect(row).toContainText("2");
});

test("AC5 · «Clientes inactivos» en Reportes: vacío si no hay; la lista completa sigue disponible", async ({ page }) => {
  test.setTimeout(60_000);
  await loginAdminUi(page, w);
  await page.goto("/app/dashboards");
  const card = page.getByTestId("summary-inactive-clients");
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText("No inactive clients right now");
  await expect(page.getByTestId("summary-inactive-clients-view-all")).toHaveCount(0);
  // The full list is still reachable by its address.
  await page.goto("/app/inactive-clients");
  await expect(page).toHaveURL(/\/app\/inactive-clients$/);
});

test("AC6 · «Cumpleaños» ya no se ve en el Inicio ni en Reportes", async ({ page }) => {
  test.setTimeout(60_000);
  await loginAdminUi(page, w);
  for (const path of ["/app", "/app/hoy", "/app/dashboards"]) {
    await page.goto(path);
    await expect(page.locator("main, [data-testid]").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("dashboard-birthdays")).toHaveCount(0);
    await expect(page.getByText("Birthdays", { exact: true })).toHaveCount(0);
  }
});
