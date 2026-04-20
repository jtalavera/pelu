import { expect, test } from "@playwright/test";
import { API_BASE, loginAsDemoApi } from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

test.describe("HU-02 · Configurar datos del negocio", () => {
  test("pantalla de negocio bajo Ajustes", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/settings/business");
    await expect(page.getByLabel("Business name")).toBeVisible();
  });

  test("HU-02 · 1 admin ve datos del tenant cargados desde el servidor", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/settings/business");
    await expect(page.getByLabel("Business name")).toHaveValue("Demo salon");
  });

  test("HU-02 · 2 guardar cambios persiste y muestra confirmación", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/settings/business");
    const unique = `Demo salon E2E ${Date.now()}`;
    await page.getByLabel("Business name").fill(unique);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Your business details were saved.")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Business name")).toHaveValue(unique);
    await page.getByLabel("Business name").fill("Demo salon");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Your business details were saved.")).toBeVisible();
  });

  test("HU-02 · 3 validación de formato RUC en cliente", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/settings/business");
    await page.getByLabel("RUC", { exact: true }).fill("bad-ruc");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(
      page.getByText("Invalid RUC. Use only digits, one hyphen, one or more digits (e.g. 80000005-6)."),
    ).toBeVisible();
  });

  test("HU-02 · 4 alerta de RUC cuando falta para facturación (dashboard)", async ({ page, request }) => {
    // Ensure no RUC is configured so the dashboard alert is visible
    const token = await loginAsDemoApi(request);
    await request.put(`${API_BASE}/api/business-profile`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      data: { businessName: "Demo salon", ruc: null, address: null, phone: null, contactEmail: null, logoDataUrl: null },
    });
    await loginAsDemo(page);
    await page.goto("/app");
    await expect(page.getByText("Add a valid business RUC to issue invoices.", { exact: true })).toBeVisible();
  });

  test("HU-02 · 6 cambios sin guardar no persisten al recargar", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/settings/business");
    const before = await page.getByLabel("Phone").inputValue();
    await page.getByLabel("Phone").fill(`${before}999`);
    await page.reload();
    await expect(page.getByLabel("Phone")).toHaveValue(before);
  });
});
