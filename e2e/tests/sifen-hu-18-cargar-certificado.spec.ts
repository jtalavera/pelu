import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { loginAsDemo } from "../fixtures/auth";

// SIFEN spec HU numbering (requirements/sifen/Especificacion_SIFEN_Peluqueria.md) is a
// separate document from the product's original HU-01..HU-30 backlog and its own e2e specs
// (e.g. hu-18-cerrar-caja-del-dia.spec.ts already exists there). To avoid collisions, every
// SIFEN spec file is prefixed "sifen-hu-<n>-...".

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VALID_P12 = path.join(__dirname, "../fixtures/sifen/test-cert.p12");
const VALID_PASSWORD = "TestPass123!";

test.describe("SIFEN HU-18 · Cargar un nuevo certificado y clave para un tenant", () => {
  test("HU-18 · 1 admin ve la opción dentro de Configuración → SIFEN con el formulario esperado (AC-01, AC-02)", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await page.goto("/app/settings");
    await page.getByRole("link", { name: "SIFEN" }).click();
    await expect(page).toHaveURL(/\/app\/settings\/sifen/);
    await expect(page.locator("#sifen-cert-file")).toBeVisible();
    await expect(page.locator("#sifen-cert-password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload certificate" })).toBeVisible();
  });

  test("HU-18 · 2 certificado y contraseña correctos se cargan y aparecen de inmediato en el listado con sus fechas (AC-05, AC-08), sin exponer la clave privada ni la contraseña (AC-06)", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await page.goto("/app/settings/sifen");

    const uploadResponsePromise = page.waitForResponse(
      (r) => r.url().endsWith("/api/sifen/certificates") && r.request().method() === "POST",
    );
    await page.locator("#sifen-cert-file").setInputFiles(VALID_P12);
    await page.locator("#sifen-cert-password").fill(VALID_PASSWORD);
    await page.getByRole("button", { name: "Upload certificate" }).click();

    const uploadResponse = await uploadResponsePromise;
    expect(uploadResponse.ok(), await uploadResponse.text()).toBeTruthy();
    const body = await uploadResponse.text();
    // AC-06: the API response must never leak the private key, the raw .p12 bytes, or the password.
    expect(body).not.toContain(VALID_PASSWORD);
    expect(body.toLowerCase()).not.toContain("password");
    expect(body.toLowerCase()).not.toContain("privatekey");

    await expect(page.getByText("The certificate was uploaded and stored securely.")).toBeVisible();
    const rows = page.getByTestId("sifen-certificate-row");
    await expect(rows.first()).toBeVisible();
    const firstRow = rows.first();
    await expect(firstRow.getByText("Upload date")).toBeVisible();
    await expect(firstRow.getByText("Issued on")).toBeVisible();
    await expect(firstRow.getByText("Expires on")).toBeVisible();
  });

  test("HU-18 · 3 cargar un segundo certificado no elimina ni afecta los anteriores (AC-10)", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await page.goto("/app/settings/sifen");
    // The page starts in a loading state (0 rows in the DOM) until the initial GET resolves;
    // wait for the upload form (only rendered once loading finishes) before counting rows.
    await expect(page.getByTestId("sifen-certificate-upload-section")).toBeVisible();
    const countBefore = await page.getByTestId("sifen-certificate-row").count();

    await page.locator("#sifen-cert-file").setInputFiles(VALID_P12);
    await page.locator("#sifen-cert-password").fill(VALID_PASSWORD);
    await page.getByRole("button", { name: "Upload certificate" }).click();
    await expect(page.getByText("The certificate was uploaded and stored securely.")).toBeVisible();

    await expect(page.getByTestId("sifen-certificate-row")).toHaveCount(countBefore + 1);
  });

  test("HU-18 · 4 contraseña incorrecta informa el error específico y no guarda nada (AC-03)", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await page.goto("/app/settings/sifen");
    // The page starts in a loading state (0 rows in the DOM) until the initial GET resolves;
    // wait for the upload form (only rendered once loading finishes) before counting rows.
    await expect(page.getByTestId("sifen-certificate-upload-section")).toBeVisible();
    const countBefore = await page.getByTestId("sifen-certificate-row").count();

    await page.locator("#sifen-cert-file").setInputFiles(VALID_P12);
    await page.locator("#sifen-cert-password").fill("wrong-password-here");
    await page.getByRole("button", { name: "Upload certificate" }).click();

    await expect(
      page.getByText("Incorrect password for the certificate file.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("sifen-certificate-row")).toHaveCount(countBefore);
  });

  test("HU-18 · 5 archivo corrupto o con formato inesperado informa el error y no guarda nada (AC-04)", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await page.goto("/app/settings/sifen");
    // The page starts in a loading state (0 rows in the DOM) until the initial GET resolves;
    // wait for the upload form (only rendered once loading finishes) before counting rows.
    await expect(page.getByTestId("sifen-certificate-upload-section")).toBeVisible();
    const countBefore = await page.getByTestId("sifen-certificate-row").count();

    const corruptFile = {
      name: "corrupt.p12",
      mimeType: "application/x-pkcs12",
      buffer: Buffer.from("this is not a valid pkcs12 keystore file"),
    };
    await page.locator("#sifen-cert-file").setInputFiles(corruptFile);
    await page.locator("#sifen-cert-password").fill(VALID_PASSWORD);
    await page.getByRole("button", { name: "Upload certificate" }).click();

    await expect(
      page.getByText("The file is not a valid .p12 certificate or is corrupted.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("sifen-certificate-row")).toHaveCount(countBefore);
  });

  test("HU-18 · 6 el formulario exige archivo y contraseña antes de enviar", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/app/settings/sifen");
    await page.getByRole("button", { name: "Upload certificate" }).click();
    await expect(page.getByText("Choose a .p12 file.")).toBeVisible();
    await expect(page.getByText("Enter the file password.")).toBeVisible();
  });
});
