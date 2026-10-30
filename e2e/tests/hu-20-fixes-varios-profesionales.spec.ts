import { expect, test } from "@playwright/test";
import { apiPostJson, loginAsDemoApi } from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";
import { professionalFormDialog, setControlledInputValue } from "../fixtures/ui";
import { openProfessionalMoreOptions, openProfessionalSchedule } from "../fixtures/catalog";

const PROFESSIONAL_PHOTO_ACCEPT =
  "image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif";

test.describe("HU-20 · Fixes varios profesionales", () => {


  test("HU-20 · 9 interruptor de estado visible en la lista de profesionales", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const name = `E2E Kebab ${Date.now()}`;
    await apiPostJson(request, token, "/api/professionals", {
      fullName: name,
      phone: null,
      email: null,
      photoDataUrl: null,
    });
    await loginAsDemo(page);
    await page.goto("/app/professionals");
    await page.locator("#professionals-inline-search").fill(name);
    const prow = page.locator('[data-testid^="prof-row-"]').filter({ hasText: name }).first();
    await expect(prow).toBeVisible({ timeout: 20_000 });
    await expect(prow.locator('[data-testid^="prof-switch-"]')).toBeVisible();
  });

  test("HU-20 · 9 tocar la fila abre un único formulario con datos y horario (sin menú de acciones)", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const fullName = `E2E Kebab2 ${Date.now()}`;
    const created = await apiPostJson<{ id: number }>(request, token, "/api/professionals", {
      fullName,
      phone: null,
      email: null,
      photoDataUrl: null,
    });
    await loginAsDemo(page);
    await page.goto("/app/professionals");
    await page.locator("#professionals-inline-search").fill(fullName);
    await expect(page.getByTestId(`prof-row-${created.id}`)).toBeVisible({ timeout: 20_000 });
    await page.getByTestId(`prof-row-${created.id}`).click();
    const dlg = professionalFormDialog(page);
    await expect(dlg.getByLabel("Full name")).toHaveValue(fullName.toUpperCase());
    await expect(dlg.getByTestId("prof-schedule-block")).toBeVisible();
    await expect(dlg.getByRole("tab")).toHaveCount(0);
  });

  test("HU-20 · 1 input de foto usa accept de tipos de imagen", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/professionals");
    await page.getByRole("button", { name: "+ New professional" }).click();
    await openProfessionalMoreOptions(page);
    const fileInput = page.locator('input[type="file"]');
    await expect(fileInput).toHaveAttribute("accept", PROFESSIONAL_PHOTO_ACCEPT);
  });

  test("HU-20 · 2 validación de extensión de archivo rechaza .txt", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/professionals");
    await page.getByRole("button", { name: "+ New professional" }).click();
    const dlg = professionalFormDialog(page);
    await openProfessionalMoreOptions(page);
    await dlg.getByLabel("Full name").fill("E2E Bad ext");
    await dlg.locator('input[type="file"]').setInputFiles({
      name: "bad.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not an image"),
    });
    await expect(
      page.getByText("Invalid file type. Use .jpg, .jpeg, .png, .webp, or .gif (e.g. ana.png).", {
        exact: true,
      }),
    ).toBeVisible();
  });

  test("HU-20 · 6 time picker en horario es un combobox editable", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/professionals");
    await page.getByRole("button", { name: "+ New professional" }).click();
    const dlg = professionalFormDialog(page);
    await dlg.getByLabel("Full name").fill("E2E Time");
    await openProfessionalSchedule(page);
    await dlg.getByTestId("prof-day-mon-active").check();
    await expect(dlg.locator("#prof-1-start")).toHaveAttribute("role", "combobox");
    await expect(dlg.locator("#prof-1-end")).toHaveAttribute("role", "combobox");
  });

  test("HU-20 · 7 teléfono usa máscara local de Paraguay", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/professionals");
    await page.getByRole("button", { name: "+ New professional" }).click();
    const dlg = professionalFormDialog(page);
    await dlg.getByLabel("Full name").fill("E2E Phone");
    const phoneField = dlg.getByLabel("Phone");
    await setControlledInputValue(phoneField, "0981123456");
    await expect(phoneField).toHaveValue("(0981) 123-456");
  });

  test("HU-20 · 8 email inválido bloquea guardado con mensaje", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/professionals");
    await page.getByRole("button", { name: "+ New professional" }).click();
    const dlg = professionalFormDialog(page);
    await openProfessionalMoreOptions(page);
    await dlg.getByLabel("Full name").fill("E2E Email");
    await setControlledInputValue(dlg.getByLabel("Email"), "@no-prefix.com");
    await dlg.getByRole("button", { name: /^Save( and set schedule)?$/ }).first().click();
    await expect(dlg.locator("#prof-email-err")).toBeVisible();
  });

  test("HU-20 · 10 horario semanal solo exige Desde/Hasta para días marcados", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/professionals");
    await page.getByRole("button", { name: "+ New professional" }).click();
    const dlg = professionalFormDialog(page);
    await dlg.getByLabel("Full name").fill("E2E Days");
    await openProfessionalSchedule(page);

    // A new professional starts Monday to Saturday; Sunday is off and has no time inputs.
    await expect(dlg.getByTestId("prof-day-mon-active")).toBeChecked();
    await expect(dlg.getByTestId("prof-day-sun-active")).not.toBeChecked();
    await expect(dlg.locator("#prof-7-start")).toHaveCount(0);

    // A marked day with a missing time blocks saving...
    await dlg.locator("#prof-1-start").fill("");
    await dlg.getByTestId("prof-save").click();
    await expect(dlg.locator("#prof-sched-err")).toBeVisible();

    // ...and unmarking that day removes the requirement.
    await dlg.getByTestId("prof-day-mon-active").uncheck();
    const respP = page.waitForResponse((r) => {
      const u = new URL(r.url());
      return u.pathname === "/api/professionals" && r.request().method() === "POST";
    });
    await dlg.getByTestId("prof-save").click();
    const resp = await respP;
    expect(resp.ok(), await resp.text()).toBeTruthy();
    await expect(dlg).toBeHidden({ timeout: 20_000 });
  });
});
