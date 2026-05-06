import { expect, test } from "@playwright/test";
import { loginAsDemo } from "../fixtures/auth";
import { setControlledInputValue } from "../fixtures/ui";

test.describe("HU-02 · Configurar datos del negocio", () => {
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
    /** `#ruc-error`: stable hook; body is i18n (en/es). Both locales cite the canonical example. */
    const rucErr = page.locator("#ruc-error");
    await expect(rucErr).toBeVisible({ timeout: 10_000 });
    await expect(rucErr).toContainText(/80000005-6/);
  });

  test("HU-02 · 4 cambios sin guardar no persisten al recargar", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/settings/business");
    const before = await page.getByLabel("Phone").inputValue();
    await page.getByLabel("Phone").fill(`${before}999`);
    await page.reload();
    await expect(page.getByLabel("Phone")).toHaveValue(before);
  });

  test("HU-02 · 5 teléfono se formatea con máscara local de Paraguay", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/settings/business");
    const phoneField = page.getByLabel("Phone");
    await setControlledInputValue(phoneField, "0981123456");
    await expect(phoneField).toHaveValue("(0981) 123-456");
  });

  test("HU-02 · 6 email inválido bloquea guardado con mensaje", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/settings/business");
    await setControlledInputValue(page.getByLabel("Contact email"), "@no-prefix.com");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.locator("#contactEmail-error")).toBeVisible();
  });
});
