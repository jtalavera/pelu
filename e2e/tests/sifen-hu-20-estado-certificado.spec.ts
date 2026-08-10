import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { loginAsDemo } from "../fixtures/auth";

// See sifen-hu-18-cargar-certificado.spec.ts for the "sifen-hu-<n>-<slug>" naming rationale.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VALID_P12 = path.join(__dirname, "../fixtures/sifen/test-cert.p12");
const EXPIRED_P12 = path.join(__dirname, "../fixtures/sifen/expired-cert.p12");
const NOT_YET_VALID_P12 = path.join(__dirname, "../fixtures/sifen/notyetvalid-cert.p12");
const PASSWORD = "TestPass123!";

async function upload(page: import("@playwright/test").Page, filePath: string) {
  await page.locator("#sifen-cert-file").setInputFiles(filePath);
  await page.locator("#sifen-cert-password").fill(PASSWORD);
  await page.getByRole("button", { name: "Upload certificate" }).click();
  await expect(page.getByText("The certificate was uploaded and stored securely.")).toBeVisible();
}

test.describe("SIFEN HU-20 · Calcular el estado de cada certificado según su vigencia", () => {
  test("HU-20 · 1 certificado vigente hoy muestra el estado Valid (AC-01)", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/settings/sifen");
    await expect(page.getByTestId("sifen-certificate-upload-section")).toBeVisible();

    await upload(page, VALID_P12);
    const row = page.getByTestId("sifen-certificate-row").first();
    await expect(row.getByText("Valid", { exact: true })).toBeVisible();
  });

  test("HU-20 · 2 certificado con fecha de vencimiento pasada muestra el estado Expired (AC-02)", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await page.goto("/app/settings/sifen");
    await expect(page.getByTestId("sifen-certificate-upload-section")).toBeVisible();

    await upload(page, EXPIRED_P12);
    const row = page.getByTestId("sifen-certificate-row").first();
    await expect(row.getByText("Expired", { exact: true })).toBeVisible();
  });

  test("HU-20 · 3 certificado cuya fecha de expedición todavía no llegó muestra Not yet valid (AC-03)", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await page.goto("/app/settings/sifen");
    await expect(page.getByTestId("sifen-certificate-upload-section")).toBeVisible();

    await upload(page, NOT_YET_VALID_P12);
    const row = page.getByTestId("sifen-certificate-row").first();
    await expect(row.getByText("Not yet valid", { exact: true })).toBeVisible();
  });

  test("HU-20 · 4 un tenant puede tener más de un certificado Valid al mismo tiempo sin error (AC-05)", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await page.goto("/app/settings/sifen");
    await expect(page.getByTestId("sifen-certificate-upload-section")).toBeVisible();

    await upload(page, VALID_P12);
    await upload(page, VALID_P12);

    const rows = page.getByTestId("sifen-certificate-row");
    await expect(rows.first().getByText("Valid", { exact: true })).toBeVisible();
    await expect(rows.nth(1).getByText("Valid", { exact: true })).toBeVisible();
  });
});
