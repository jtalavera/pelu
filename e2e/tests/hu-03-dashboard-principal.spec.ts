import { expect, test } from "@playwright/test";
import { loginAsDemo } from "../fixtures/auth";

test.describe("HU-03 · Dashboard principal", () => {
  test("HU-03 · 1 métricas de ingresos y citas del día", async ({ page }) => {
    await loginAsDemo(page);
    await expect(page.getByText("Revenue today", { exact: true })).toBeVisible();
    await expect(page.getByText("Appointments today", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Gs.", { exact: false }).first()).toBeVisible();
  });

  test("HU-03 · 2 accesos rápidos a calendario y nueva cita", async ({ page }) => {
    await loginAsDemo(page);
    await page.getByRole("link", { name: "View agenda →" }).click();
    await expect(page).toHaveURL(/\/app\/calendar/);
    await page.goto("/app");
    await page.getByRole("button", { name: "+ New appointment" }).click();
    await expect(page).toHaveURL(/\/app\/calendar/);
  });

  test("HU-03 · 4 estado vacío cuando no hay citas hoy", async ({ page }) => {
    await loginAsDemo(page);
    await expect(page.getByText("No appointments today", { exact: true }).first()).toBeVisible();
  });
});
