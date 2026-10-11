import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { apiPostJsonStatus, loginAsDemoApi, setTenantFeatureFlag } from "../fixtures/api";
import { loginAsDemo, loginAsPlatformAdmin } from "../fixtures/auth";
import { openTenantSifenAsRoot } from "../fixtures/sifenRoot";

const DEMO_TENANT_ID = 1;
const SIFEN_FLAG_KEY = "SIFEN_ELECTRONIC_INVOICING";

// The certificate is a fiscal credential: it is loaded ONLY by the platform's root user (Plataforma →
// Salones → SIFEN). The salon's administrator sees the list read-only in Configuración → SIFEN.
//
// SIFEN spec HU numbering (requirements/sifen/Especificacion_SIFEN_Peluqueria.md) is a
// separate document from the product's original HU-01..HU-30 backlog and its own e2e specs
// (e.g. hu-18-cerrar-caja-del-dia.spec.ts already exists there). To avoid collisions, every
// SIFEN spec file is prefixed "sifen-hu-<n>-...".

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VALID_P12 = path.join(__dirname, "../fixtures/sifen/test-cert.p12");
const VALID_PASSWORD = "TestPass123!";

test.describe("SIFEN HU-18 · Cargar un nuevo certificado y clave para un tenant", () => {
  // Configuración → SIFEN is itself gated on this tenant flag — self-contained rather than
  // relying on some earlier spec having left it on.
  test.beforeEach(async ({ request }) => {
    await setTenantFeatureFlag(request, DEMO_TENANT_ID, SIFEN_FLAG_KEY, true);
  });
  test.afterEach(async ({ request }) => {
    await setTenantFeatureFlag(request, DEMO_TENANT_ID, SIFEN_FLAG_KEY, false);
  });

  test("HU-18 · 1 solo el usuario root carga el certificado: lo ve en Plataforma → Salones → SIFEN, el admin del salón no (AC-01, AC-02)", async ({
    page,
    request,
  }) => {
    // Root user: reaches the tenant's SIFEN page from the tenant's edit dialog.
    await loginAsPlatformAdmin(page);
    await page.goto("/platform/tenants");
    // Other specs create many tenants, so the demo salon may not be on the first page: search it.
    const search = page.getByLabel("Search by name or domain");
    await search.fill("Demo salon");
    await search.press("Enter");
    await page.getByTestId(`platform-tenant-row-${DEMO_TENANT_ID}`).click();
    await page.getByTestId("platform-tenant-sifen-link").click();
    await expect(page).toHaveURL(new RegExp(`/platform/tenants/${DEMO_TENANT_ID}/sifen$`));
    await expect(page.locator("#sifen-cert-file")).toBeVisible();
    await expect(page.locator("#sifen-cert-password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload certificate" })).toBeVisible();

    // The API refuses the salon's administrator: there is no tenant-side upload endpoint, and the
    // platform one is closed to them.
    const token = await loginAsDemoApi(request);
    const tenantUpload = await apiPostJsonStatus(request, token, "/api/sifen/certificates", {
      fileBase64: "AAAA",
      password: "x",
    });
    expect([403, 405]).toContain(tenantUpload.status); // no such tenant-side endpoint
    const platformUpload = await apiPostJsonStatus(
      request,
      token,
      `/api/platform/tenants/${DEMO_TENANT_ID}/sifen/certificates`,
      { fileBase64: "AAAA", password: "x" },
    );
    expect(platformUpload.status).toBe(403);
  });

  test("HU-18 · 1b el administrador del salón no tiene formulario de carga en Configuración → SIFEN (AC-01)", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await page.goto("/app/settings/sifen");

    await expect(page.getByTestId("sifen-certificate-list-section")).toBeVisible();
    await expect(page.getByTestId("sifen-certificate-readonly-note")).toBeVisible();
    await expect(page.locator("#sifen-cert-file")).toHaveCount(0);
    await expect(page.locator("#sifen-cert-password")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Upload certificate" })).toHaveCount(0);
  });

  test("HU-18 · 2 certificado y contraseña correctos se cargan y aparecen de inmediato en el listado con sus fechas (AC-05, AC-08), sin exponer la clave privada ni la contraseña (AC-06)", async ({
    page,
  }) => {
    await openTenantSifenAsRoot(page);

    const uploadResponsePromise = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/platform/tenants/${DEMO_TENANT_ID}/sifen/certificates`) &&
        r.request().method() === "POST",
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
    // Issue #190 — certificates are shown in a table; the field labels are column headers.
    const listSection = page.getByTestId("sifen-certificate-list-section");
    await expect(listSection.getByRole("columnheader", { name: "Upload date" })).toBeVisible();
    await expect(listSection.getByRole("columnheader", { name: "Issued on" })).toBeVisible();
    await expect(listSection.getByRole("columnheader", { name: "Expires on" })).toBeVisible();
    await expect(page.getByTestId("sifen-certificate-row").first()).toBeVisible();
  });

  test("HU-18 · 3 cargar un segundo certificado no elimina ni afecta los anteriores (AC-10)", async ({
    page,
  }) => {
    await openTenantSifenAsRoot(page);
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
    await openTenantSifenAsRoot(page);
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
    await openTenantSifenAsRoot(page);
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
    await openTenantSifenAsRoot(page);
    await page.getByRole("button", { name: "Upload certificate" }).click();
    await expect(page.getByText("Choose a .p12 file.")).toBeVisible();
    await expect(page.getByText("Enter the file password.")).toBeVisible();
  });
});
