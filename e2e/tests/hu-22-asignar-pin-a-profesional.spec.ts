import { expect, test } from "@playwright/test";
import { loginAsDemo } from "../fixtures/auth";

test.describe("HU-22 · Asignar PIN a profesional", () => {
  test("HU-22 · 1 campo PIN visible en el formulario de detalles", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/professionals");
    await page.getByRole("button", { name: "+ New professional" }).click();
    const dlg = page.getByRole("dialog");
    await expect(dlg.locator("#prof-pin")).toBeVisible();
  });

  test("HU-22 · 7 el campo PIN usa type password (se enmascaran los dígitos)", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/professionals");
    await page.getByRole("button", { name: "+ New professional" }).click();
    const dlg = page.getByRole("dialog");
    await expect(dlg.locator("#prof-pin")).toHaveAttribute("type", "password");
  });

  test("HU-22 · 2 PIN no numérico es rechazado en frontend", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/professionals");
    await page.getByRole("button", { name: "+ New professional" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Full name").fill(`E2E PIN ${Date.now()}`);
    await dlg.locator("#prof-pin").fill("abcd");
    await dlg.getByRole("button", { name: "Save and set schedule" }).click();
    await expect(dlg.getByText(/PIN must be between 4 and 7 numeric digits/)).toBeVisible();
  });

  test("HU-22 · 3 PIN con menos de 4 dígitos es rechazado", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/professionals");
    await page.getByRole("button", { name: "+ New professional" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Full name").fill(`E2E PIN Short ${Date.now()}`);
    await dlg.locator("#prof-pin").fill("123");
    await dlg.getByRole("button", { name: "Save and set schedule" }).click();
    await expect(dlg.getByText(/PIN must be between 4 and 7 numeric digits/)).toBeVisible();
  });

  test("HU-22 · 3b PIN con más de 7 dígitos es rechazado", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/professionals");
    await page.getByRole("button", { name: "+ New professional" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Full name").fill(`E2E PIN Long ${Date.now()}`);
    await dlg.locator("#prof-pin").fill("12345678");
    await dlg.getByRole("button", { name: "Save and set schedule" }).click();
    await expect(dlg.getByText(/PIN must be between 4 and 7 numeric digits/)).toBeVisible();
  });

  test("HU-22 · guardado valores PIN 4 dígitos", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/professionals");
    const suffix = Date.now();
    const name = `E2E PIN4 ${suffix}`;
    const pin4 = String(suffix).slice(-4);
    await page.getByRole("button", { name: "+ New professional" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Full name").fill(name);
    await dlg.locator("#prof-pin").fill(pin4);
    await dlg.getByRole("button", { name: "Save and set schedule" }).click();
    await expect(dlg.getByRole("button", { name: "Save schedule" })).toBeVisible();
  });

  test("HU-22 · guardado valores PIN 7 dígitos", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/professionals");
    const suffix = Date.now();
    const name = `E2E PIN7 ${suffix}`;
    const pin7 = String(suffix).slice(-7);
    await page.getByRole("button", { name: "+ New professional" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Full name").fill(name);
    await dlg.locator("#prof-pin").fill(pin7);
    await dlg.getByRole("button", { name: "Save and set schedule" }).click();
    await expect(dlg.getByRole("button", { name: "Save schedule" })).toBeVisible();
  });

  test("HU-22 · 4 PIN duplicado dentro del mismo tenant es rechazado", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/professionals");

    const pin = String(Date.now()).slice(-6);

    const name1 = `E2E DupPin1 ${Date.now()}`;
    await page.getByRole("button", { name: "+ New professional" }).click();
    let dlg = page.getByRole("dialog");
    await dlg.getByLabel("Full name").fill(name1);
    await dlg.locator("#prof-pin").fill(pin);
    await dlg.getByRole("button", { name: "Save and set schedule" }).click();
    await dlg.getByRole("button", { name: "Save schedule" }).evaluate((el: HTMLElement) => (el as HTMLButtonElement).click());
    await expect(page.getByText(name1, { exact: true }).first()).toBeVisible();

    const name2 = `E2E DupPin2 ${Date.now()}`;
    await page.getByRole("button", { name: "+ New professional" }).click();
    dlg = page.getByRole("dialog");
    await dlg.getByLabel("Full name").fill(name2);
    await dlg.locator("#prof-pin").fill(pin);
    await dlg.getByRole("button", { name: "Save and set schedule" }).click();
    await expect(dlg.getByText(/already assigned/i)).toBeVisible();
  });

  test("HU-22 · 5 PIN es opcional — profesional sin PIN se crea correctamente", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/professionals");
    const name = `E2E NoPin ${Date.now()}`;
    await page.getByRole("button", { name: "+ New professional" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Full name").fill(name);
    await dlg.getByRole("button", { name: "Save and set schedule" }).click();
    await expect(dlg.getByRole("button", { name: "Save schedule" })).toBeVisible();
  });

  test("HU-22 · 8 PIN existente puede eliminarse dejando el campo vacío", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/professionals");
    const name = `E2E ClearPin ${Date.now()}`;

    await page.getByRole("button", { name: "+ New professional" }).click();
    let dlg = page.getByRole("dialog");
    await dlg.getByLabel("Full name").fill(name);
    await dlg.locator("#prof-pin").fill(String(Date.now()).slice(-6));
    await dlg.getByRole("button", { name: "Save and set schedule" }).click();
    await dlg.getByRole("button", { name: "Save schedule" }).evaluate((el: HTMLElement) => (el as HTMLButtonElement).click());
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();

    const row = page.locator("tr").filter({ hasText: name });
    await row.getByRole("button", { name: "More…", exact: true }).click();
    dlg = page.getByRole("dialog");
    await expect(dlg.locator("#prof-pin")).toHaveAttribute("type", "password");
    await dlg.getByRole("button", { name: "Save and set schedule" }).click();
    await expect(dlg.getByRole("button", { name: "Save schedule" })).toBeVisible();
  });
});
