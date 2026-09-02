import { expect, test } from "@playwright/test";
import { loginAsDemo } from "../fixtures/auth";
import { setControlledInputValue } from "../fixtures/ui";

test.describe("HU-02 · Configurar datos del negocio", () => {
  test("HU-02 · 1 admin ve datos del tenant cargados desde el servidor", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/settings/business");
    await expect(page.getByLabel("Business or legal name")).toHaveValue("Demo salon");
  });

  test("HU-02 · 2 guardar cambios persiste y muestra confirmación", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/settings/business");
    const unique = `Demo salon E2E ${Date.now()}`;
    await page.getByLabel("Business or legal name").fill(unique);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Your business details were saved.")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Business or legal name")).toHaveValue(unique);
    await page.getByLabel("Business or legal name").fill("Demo salon");
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

  // Issue #186 · AC5 + AC6 — the business-name field is relabelled, and the trade-name field
  // sits directly below it in the General section (visible regardless of the SIFEN flag).
  test("Issue #186 · nombre del negocio relabelado y nombre de fantasía debajo", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/settings/business");

    const businessName = page.locator("#businessName");
    const tradeName = page.locator("#sifenFantasyName");
    await expect(businessName).toBeVisible();
    await expect(tradeName).toBeVisible();

    // AC6 — the label reads "Business or legal name".
    await expect(page.locator('label[for="businessName"]')).toHaveText(/Business or legal name/);

    // AC5 — trade name sits below the business name and above the address (i.e. in the
    // General section, right after business name). Read-only: the /api/business-profile
    // singleton is mutated by other specs running in parallel.
    const bnBox = await businessName.boundingBox();
    const tnBox = await tradeName.boundingBox();
    const addressBox = await page.locator("#address").boundingBox();
    expect(tnBox!.y).toBeGreaterThan(bnBox!.y);
    expect(tnBox!.y).toBeLessThan(addressBox!.y);

    // The hint still describes the KuDE header use.
    await expect(page.locator("#sifenFantasyName-hint")).toBeVisible();
  });
});
