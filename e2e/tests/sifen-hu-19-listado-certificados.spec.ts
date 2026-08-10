import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { API_BASE } from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

// See sifen-hu-18-cargar-certificado.spec.ts for the "sifen-hu-<n>-<slug>" naming rationale.
//
// HU-19 is purely a read-only view over what HU-18 (upload/storage) and HU-20 (vigencia/status
// calculation) already built — the list endpoint (GET /api/sifen/certificates) and its DTO
// (SifenCertificateResponse) already existed before this story; HU-19 only adds the empty-state
// shortcut (AC-05) and this dedicated test coverage.
//
// AC-04 (tenant isolation) is NOT covered here: no second-tenant fixture exists in this repo's
// e2e infra (same gap already documented by HU-18's own "Desviación conocida" in PROGRESS.md) —
// it's covered on the backend instead, by SifenCertificateServiceTest's
// list_onlyQueriesRequestedTenant_neverLeaksOtherTenants.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VALID_P12 = path.join(__dirname, "../fixtures/sifen/test-cert.p12");
const VALID_PASSWORD = "TestPass123!";

async function upload(page: import("@playwright/test").Page, filePath: string) {
  await page.locator("#sifen-cert-file").setInputFiles(filePath);
  await page.locator("#sifen-cert-password").fill(VALID_PASSWORD);
  await page.getByRole("button", { name: "Upload certificate" }).click();
  await expect(page.getByText("The certificate was uploaded and stored securely.")).toBeVisible();
}

test.describe("SIFEN HU-19 · Ver el listado de certificados cargados de un tenant", () => {
  test("HU-19 · 1 el listado se muestra en Configuración → SIFEN, en la misma sección que la carga (AC-01)", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await page.goto("/app/settings");
    await page.getByRole("link", { name: "SIFEN" }).click();
    await expect(page).toHaveURL(/\/app\/settings\/sifen/);

    // Both the upload form and the list live inside the same page/section, not separate screens.
    await expect(page.getByTestId("sifen-certificate-upload-section")).toBeVisible();
    await expect(page.getByTestId("sifen-certificate-list-section")).toBeVisible();
  });

  test("HU-19 · 2 cada certificado muestra únicamente los 4 campos permitidos, sin exponer clave privada ni contraseña (AC-02, AC-03)", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await page.goto("/app/settings/sifen");
    await expect(page.getByTestId("sifen-certificate-upload-section")).toBeVisible();

    // Set up the listener before uploading: the upload's onSubmit re-fetches the list via
    // load() once the POST resolves (see SifenCertificatesPage.tsx), so the matching GET always
    // fires sometime during/after upload() below — the listener stays attached until then.
    const listResponsePromise = page.waitForResponse(
      (r) => r.url().endsWith("/api/sifen/certificates") && r.request().method() === "GET",
    );
    await upload(page, VALID_P12);
    const listResponse = await listResponsePromise;
    const body = (await listResponse.json()) as Array<Record<string, unknown>>;
    expect(body.length).toBeGreaterThan(0);
    for (const row of body) {
      // AC-02/AC-03: exactly these keys, nothing more — "id" is only the row's technical
      // identifier (used as the React key), not certificate data, same as every other list in
      // this app.
      expect(Object.keys(row).sort()).toEqual(
        ["id", "notAfter", "notBefore", "status", "uploadedAt"].sort(),
      );
    }
    // AC-03: never the private key, the .p12 bytes, or the password, in any shape.
    const rawText = JSON.stringify(body).toLowerCase();
    expect(rawText).not.toContain("password");
    expect(rawText).not.toContain("privatekey");
    expect(rawText).not.toContain(VALID_PASSWORD.toLowerCase());

    const row = page.getByTestId("sifen-certificate-row").first();
    await expect(row.getByText("Upload date")).toBeVisible();
    await expect(row.getByText("Issued on")).toBeVisible();
    await expect(row.getByText("Expires on")).toBeVisible();
    // Status is rendered as a badge (Valid/Expired/Not yet valid), not repeated as a text label
    // per row — assert the badge itself is present.
    await expect(
      row.getByText(/^(Valid|Expired|Not yet valid)$/, { exact: true }),
    ).toBeVisible();
  });

  test("HU-19 · 3 sin certificados cargados, el listado muestra el estado vacío con acceso directo a la carga (AC-05)", async ({
    page,
    request,
  }) => {
    // Guarantee a known-zero state regardless of what other SIFEN specs uploaded earlier in this
    // run (they never assume/assert an absolute starting count — see the test-support endpoint's
    // javadoc for why this is safe).
    const clearRes = await request.post(`${API_BASE}/api/admin/sifen-test-support/certificates/clear`);
    expect(clearRes.ok(), await clearRes.text()).toBeTruthy();

    await loginAsDemo(page);
    await page.goto("/app/settings/sifen");
    await expect(page.getByTestId("sifen-certificate-upload-section")).toBeVisible();

    await expect(page.getByTestId("sifen-certificate-empty-state")).toBeVisible();
    await expect(page.getByText("No certificates uploaded yet.")).toBeVisible();
    await expect(page.getByTestId("sifen-certificate-row")).toHaveCount(0);

    const shortcut = page.getByRole("button", { name: "Upload your first certificate" });
    await expect(shortcut).toBeVisible();
    await shortcut.click();
    await expect(page.locator("#sifen-cert-file")).toBeFocused();
  });

  test("HU-19 · 4 el listado incluye todos los certificados cargados históricamente, no solo el más reciente (AC-06)", async ({
    page,
    request,
  }) => {
    const clearRes = await request.post(`${API_BASE}/api/admin/sifen-test-support/certificates/clear`);
    expect(clearRes.ok(), await clearRes.text()).toBeTruthy();

    await loginAsDemo(page);
    await page.goto("/app/settings/sifen");
    await expect(page.getByTestId("sifen-certificate-upload-section")).toBeVisible();
    await expect(page.getByTestId("sifen-certificate-empty-state")).toBeVisible();

    await upload(page, VALID_P12);
    await expect(page.getByTestId("sifen-certificate-row")).toHaveCount(1);

    await upload(page, VALID_P12);
    await expect(page.getByTestId("sifen-certificate-row")).toHaveCount(2);

    await upload(page, VALID_P12);
    await expect(page.getByTestId("sifen-certificate-row")).toHaveCount(3);

    // Reloading the page (a fresh GET) must still show all 3, not just the newest.
    await page.reload();
    await expect(page.getByTestId("sifen-certificate-upload-section")).toBeVisible();
    await expect(page.getByTestId("sifen-certificate-row")).toHaveCount(3);
  });
});
