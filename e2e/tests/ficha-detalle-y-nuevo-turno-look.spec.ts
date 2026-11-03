import { expect, test } from "@playwright/test";
import {
  apiPostJson,
  loginAsDemoApi,
  seedCategoryServiceProfessional,
  seedClient,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { bookingAppointmentDialog } from "../fixtures/ui";

/**
 * Look and feel: (1) detalle de la ficha: «+ Agregar servicio» es una fila punteada al final de la
 * lista y las propinas son una lista vertical (una profesional por línea, nombre completo, total
 * en el encabezado); (2) «Nuevo turno»: los horarios rápidos van justo bajo la Hora y la duración,
 * en su tarjeta, al final.
 */
test.describe.configure({ mode: "serial" });

test("detalle de la ficha: agregar servicio punteado al final y propinas una debajo de otra", async ({ page, request }) => {
  const admin = await loginAsDemoApi(request);
  const seed = await seedCategoryServiceProfessional(request, admin);
  const second = await seedCategoryServiceProfessional(request, admin);
  const client = await seedClient(request, admin, `E2E Look Ficha ${Date.now()}`);
  const ficha = await apiPostJson<{ id: number }>(request, admin, "/api/service-records", {
    clientId: client.id,
    lines: [
      { serviceId: seed.serviceId, professionalId: seed.professionalId, quantity: 1, unitPrice: 40_000 },
      { serviceId: second.serviceId, professionalId: second.professionalId, quantity: 1, unitPrice: 25_000 },
    ],
    tips: [],
  });
  expect(ficha.id).toBeGreaterThan(0);

  await loginAsDemo(page);
  const card = page.getByTestId("dashboard-service-record-card").filter({ hasText: client.fullName });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.click({ position: { x: 40, y: 20 } });
  const dialog = page.getByRole("dialog");

  // «+ Agregar servicio»: a dashed row after the last service, before the total.
  const add = dialog.getByTestId("service-record-add-line");
  await expect(add).toHaveClass(/border-dashed/);
  const lastLine = dialog.getByTestId("service-record-line").last();
  const total = dialog.getByTestId("service-record-total");
  const [lastBox, addBox, totalBox] = await Promise.all([lastLine.boundingBox(), add.boundingBox(), total.boundingBox()]);
  expect(addBox!.y).toBeGreaterThan(lastBox!.y);
  expect(addBox!.y).toBeLessThan(totalBox!.y);
  expect(addBox!.height).toBeGreaterThanOrEqual(44);

  // Tips: one professional per line, full names, the second under the first.
  await dialog.getByTestId("service-record-tips-toggle").click();
  const tip1 = dialog.locator(`#service-record-tip-${seed.professionalId}`);
  const tip2 = dialog.locator(`#service-record-tip-${second.professionalId}`);
  const [b1, b2] = await Promise.all([tip1.boundingBox(), tip2.boundingBox()]);
  expect(b2!.y).toBeGreaterThan(b1!.y + b1!.height - 1);
  expect(Math.abs(b2!.x - b1!.x)).toBeLessThan(2);
  await expect(dialog.getByTestId("service-record-tips")).toContainText(seed.professionalFullName);
  await expect(dialog.getByTestId("service-record-tips")).toContainText(second.professionalFullName);

  // The header shows the tips total once there is one.
  await expect(dialog.getByTestId("service-record-tips-total")).toHaveCount(0);
  await tip1.fill("5000");
  await expect(dialog.getByTestId("service-record-tips-total")).toContainText("5.000");
  await page.screenshot({ path: process.env.SHOT_FICHA ?? "test-results/ficha.png" });
});

test("Nuevo turno: horarios rápidos bajo la hora y la duración al final, en su tarjeta", async ({ page, request }) => {
  const admin = await loginAsDemoApi(request);
  const seed = await seedCategoryServiceProfessional(request, admin);
  await seedClient(request, admin, `E2E Look Turno ${Date.now()}`);
  void seed;
  await loginAsDemo(page);
  await page.goto("/app/calendar?view=week");
  await page.getByRole("button", { name: "New appointment" }).first().click();
  const dlg = bookingAppointmentDialog(page);
  await expect(dlg).toBeVisible();

  const time = dlg.locator("#form-time");
  const date = dlg.locator("#form-date");
  const quick = dlg.getByTestId("appointment-quick-times");
  const duration = dlg.getByTestId("appointment-duration");
  const [tb, db, qb, ub] = await Promise.all([time.boundingBox(), date.boundingBox(), quick.boundingBox(), duration.boundingBox()]);
  // Fecha and Hora share a row; the quick times come right below; the duration card is last.
  expect(Math.abs(tb!.y - db!.y)).toBeLessThan(6);
  expect(qb!.y).toBeGreaterThan(tb!.y + tb!.height - 1);
  expect(ub!.y).toBeGreaterThan(qb!.y + qb!.height - 1);

  // Servicio and Profesional share a row on a wide screen.
  const [sb, pb] = await Promise.all([dlg.locator("#form-service").boundingBox(), dlg.locator("#form-professional").boundingBox()]);
  expect(Math.abs(sb!.y - pb!.y)).toBeLessThan(6);
  await expect(dlg.getByText("Who and what")).toBeVisible();
  await expect(dlg.getByText("When", { exact: true })).toBeVisible();
  await page.screenshot({ path: process.env.SHOT_TURNO ?? "test-results/turno.png" });
});
