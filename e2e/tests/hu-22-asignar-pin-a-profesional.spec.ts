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

  test("HU-22 · 1 PIN de 4 dígitos válido se guarda correctamente", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/professionals");
    const name = `E2E PIN4 ${Date.now()}`;
    await page.getByRole("button", { name: "+ New professional" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Full name").fill(name);
    await dlg.locator("#prof-pin").fill("1234");
    await dlg.getByRole("button", { name: "Save and set schedule" }).click();
    // should move to schedule tab without error
    await expect(dlg.getByRole("button", { name: "Save schedule" })).toBeVisible();
  });

  test("HU-22 · 1 PIN de 7 dígitos válido se guarda correctamente", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/professionals");
    const name = `E2E PIN7 ${Date.now()}`;
    await page.getByRole("button", { name: "+ New professional" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Full name").fill(name);
    await dlg.locator("#prof-pin").fill("7654321");
    await dlg.getByRole("button", { name: "Save and set schedule" }).click();
    await expect(dlg.getByRole("button", { name: "Save schedule" })).toBeVisible();
  });

  test("HU-22 · 4 PIN duplicado dentro del mismo tenant es rechazado", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/professionals");

    const pin = `9${String(Date.now()).slice(-4)}`;

    // Create first professional with the PIN
    const name1 = `E2E DupPin1 ${Date.now()}`;
    await page.getByRole("button", { name: "+ New professional" }).click();
    let dlg = page.getByRole("dialog");
    await dlg.getByLabel("Full name").fill(name1);
    await dlg.locator("#prof-pin").fill(pin);
    await dlg.getByRole("button", { name: "Save and set schedule" }).click();
    await dlg.getByRole("button", { name: "Save schedule" }).evaluate((el: HTMLElement) => (el as HTMLButtonElement).click());
    await expect(page.getByText(name1, { exact: true }).first()).toBeVisible();

    // Try to create second professional with same PIN
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
    // Leave PIN empty
    await dlg.getByRole("button", { name: "Save and set schedule" }).click();
    await expect(dlg.getByRole("button", { name: "Save schedule" })).toBeVisible();
  });

  test("HU-22 · 8 PIN existente puede eliminarse dejando el campo vacío", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/professionals");
    const name = `E2E ClearPin ${Date.now()}`;

    // Create with a PIN
    await page.getByRole("button", { name: "+ New professional" }).click();
    let dlg = page.getByRole("dialog");
    await dlg.getByLabel("Full name").fill(name);
    await dlg.locator("#prof-pin").fill("5555");
    await dlg.getByRole("button", { name: "Save and set schedule" }).click();
    await dlg.getByRole("button", { name: "Save schedule" }).evaluate((el: HTMLElement) => (el as HTMLButtonElement).click());
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();

    // Edit and clear PIN — re-open modal
    const row = page.locator("tr").filter({ hasText: name });
    await row.getByRole("button", { name: "Schedule & photo" }).click();
    dlg = page.getByRole("dialog");
    await expect(dlg.getByText(/PIN already configured/i)).toBeVisible();
    // Leave PIN field empty and save
    await dlg.getByRole("button", { name: "Save and set schedule" }).click();
    // Should advance to schedule tab without error
    await expect(dlg.getByRole("button", { name: "Save schedule" })).toBeVisible();
  });
});
