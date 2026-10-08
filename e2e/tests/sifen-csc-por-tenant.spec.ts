import { expect, test } from "@playwright/test";
import {
  API_BASE,
  apiGetJson,
  apiPostJsonStatus,
  authHeaders,
  loginAsDemoApi,
  setTenantFeatureFlag,
} from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

// Per-tenant CSC (Código de Seguridad del Contribuyente): the DNIT issues each taxpayer its own CSC
// and validates every invoice QR with it, so each salon loads its own in Configuración → SIFEN →
// "Security code (CSC)". The value is a secret: write-only — never shown again, never returned by
// the API. Cross-tenant isolation (lists, activation, same IdCSC in two salons) is covered by
// tests/mt-isolation/mt-sifen.spec.ts (scenario 7); the hash itself by SifenQrCodeServiceTest /
// SifenDocumentSigningServiceTest.

const DEMO_TENANT_ID = 1;
const SIFEN_FLAG_KEY = "SIFEN_ELECTRONIC_INVOICING";
const CSC_VALUE = "A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6";
const CSC_VALUE_2 = "Z9Y8X7W6V5U4T3S2R1Q0P9O8N7M6L5K4";

async function clearCsc(request: import("@playwright/test").APIRequestContext) {
  const res = await request.post(`${API_BASE}/api/admin/sifen-test-support/csc/clear`);
  expect(res.ok(), await res.text()).toBeTruthy();
}

async function openCscTab(page: import("@playwright/test").Page) {
  await page.goto("/app/settings/sifen");
  await page.getByRole("tab", { name: "Security code (CSC)" }).click();
  await expect(page.getByTestId("sifen-csc-section")).toBeVisible();
}

async function loadCsc(page: import("@playwright/test").Page, idCsc: string, csc: string) {
  await page.locator("#sifen-csc-id").fill(idCsc);
  await page.locator("#sifen-csc-value").fill(csc);
  await page.getByRole("button", { name: "Save security code" }).click();
}

test.describe("SIFEN · CSC por salón (Configuración → SIFEN → Código de seguridad)", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ request }) => {
    await setTenantFeatureFlag(request, DEMO_TENANT_ID, SIFEN_FLAG_KEY, true);
    await clearCsc(request);
  });
  test.afterEach(async ({ request }) => {
    // Leave the shared demo tenant on the SET's public test CSC, like every other SIFEN spec expects.
    await clearCsc(request);
    await setTenantFeatureFlag(request, DEMO_TENANT_ID, SIFEN_FLAG_KEY, false);
  });

  test("CSC · 1 la solapa existe, está vacía y avisa que se usa el CSC de prueba (ambiente TEST)", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await openCscTab(page);

    await expect(page.getByTestId("sifen-csc-empty")).toBeVisible();
    await expect(page.getByTestId("sifen-csc-test-fallback")).toBeVisible();
    await expect(page.getByTestId("sifen-csc-missing-production")).toHaveCount(0);
    // The CSC is typed into a password field (never echoed back).
    await expect(page.locator("#sifen-csc-value")).toHaveAttribute("type", "password");
  });

  test("CSC · 2 valida el IdCSC y el formato del CSC, con ejemplo concreto", async ({ page }) => {
    await loginAsDemo(page);
    await openCscTab(page);

    await loadCsc(page, "0", "TOO-SHORT");

    await expect(page.locator("#sifen-csc-id-err")).toContainText("between 1 and 9999 (e.g. 1)");
    await expect(page.locator("#sifen-csc-value-err")).toContainText(
      "exactly 32 letters or digits, with no spaces or symbols (e.g. A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6)",
    );
    await expect(page.locator("#sifen-csc-id")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByTestId("sifen-csc-empty")).toBeVisible(); // nothing was stored
  });

  test("CSC · 3 el primer CSC queda activo, el valor nunca se muestra ni lo devuelve la API", async ({
    page,
    request,
  }) => {
    await loginAsDemo(page);
    await openCscTab(page);

    await loadCsc(page, "5", CSC_VALUE);

    await expect(page.getByTestId("sifen-csc-saved")).toContainText("IdCSC 0005");
    const row = page.getByTestId("sifen-csc-row-5");
    await expect(row).toBeVisible();
    await expect(row).toContainText("0005");
    await expect(row).toContainText("Active");
    await expect(page.getByTestId("sifen-csc-test-fallback")).toHaveCount(0);

    // Write-only: the form is cleared and the value is nowhere in the page …
    await expect(page.locator("#sifen-csc-value")).toHaveValue("");
    expect(await page.content()).not.toContain(CSC_VALUE);
    // … nor in what the API returns.
    const token = await loginAsDemoApi(request);
    const apiRows = await apiGetJson<Array<{ idCsc: number; active: boolean }>>(
      request,
      token,
      "/api/sifen/csc",
    );
    expect(apiRows).toHaveLength(1);
    expect(apiRows[0]).toMatchObject({ idCsc: 5, active: true });
    expect(JSON.stringify(apiRows)).not.toContain(CSC_VALUE);

    // It survives a reload (persisted, not just client state).
    await openCscTab(page);
    await expect(page.getByTestId("sifen-csc-row-5")).toContainText("Active");
  });

  test("CSC · 4 un segundo CSC queda inactivo hasta que se lo activa; solo hay uno activo", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await openCscTab(page);
    await loadCsc(page, "5", CSC_VALUE);
    await expect(page.getByTestId("sifen-csc-row-5")).toContainText("Active");

    await loadCsc(page, "6", CSC_VALUE_2);
    await expect(page.getByTestId("sifen-csc-row-6")).toBeVisible();
    await expect(page.getByTestId("sifen-csc-row-6")).toContainText("Inactive");
    await expect(page.getByTestId("sifen-csc-row-5")).toContainText("Active");
    await expect(page.getByTestId("sifen-csc-activate-5")).toHaveCount(0);

    await page.getByTestId("sifen-csc-activate-6").click();

    await expect(page.getByTestId("sifen-csc-row-6")).toContainText("Active");
    await expect(page.getByTestId("sifen-csc-row-5")).toContainText("Inactive");
    await expect(page.getByTestId("sifen-csc-activate-5")).toBeVisible();
    await expect(page.getByTestId("sifen-csc-activate-6")).toHaveCount(0);
  });

  test("CSC · 5 cargar de nuevo el mismo IdCSC reemplaza su valor sin duplicar filas", async ({
    page,
  }) => {
    await loginAsDemo(page);
    await openCscTab(page);
    await loadCsc(page, "5", CSC_VALUE);
    await expect(page.getByTestId("sifen-csc-row-5")).toBeVisible();

    await loadCsc(page, "5", CSC_VALUE_2);

    await expect(page.getByTestId("sifen-csc-saved")).toContainText("was replaced");
    await expect(page.locator('[data-testid^="sifen-csc-row-"]')).toHaveCount(1);
    await expect(page.getByTestId("sifen-csc-row-5")).toContainText("Active");
  });

  test("CSC · 6 la API rechaza valores inválidos con códigos de error y activar uno inexistente da 404", async ({
    request,
  }) => {
    const token = await loginAsDemoApi(request);

    const badId = await apiPostJsonStatus(request, token, "/api/sifen/csc", {
      idCsc: 10000,
      csc: CSC_VALUE,
    });
    expect(badId.status).toBe(400);
    expect(badId.text).toContain("INVALID_CSC_ID");

    for (const bad of ["", "TOO-SHORT", `${CSC_VALUE}X`, "A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5-6"]) {
      const res = await apiPostJsonStatus(request, token, "/api/sifen/csc", {
        idCsc: 5,
        csc: bad,
      });
      expect(res.status, bad).toBe(400);
      expect(res.text).toContain("INVALID_CSC_FORMAT");
    }

    const notFound = await apiPostJsonStatus(request, token, "/api/sifen/csc/77/activate", {});
    expect(notFound.status).toBe(404);
    expect(notFound.text).toContain("CSC_NOT_FOUND");

    const res = await request.get(`${API_BASE}/api/sifen/csc`, { headers: authHeaders(token) });
    expect(await res.json()).toEqual([]); // nothing was stored by the invalid calls
  });

  test("CSC · 7 el cambio de CSC no requiere deploy: se carga y queda disponible al instante", async ({
    request,
  }) => {
    // Loading a CSC is plain tenant configuration (DB row + secret store) — the same running
    // backend serves the new value on the next request, with no redeploy or restart.
    const token = await loginAsDemoApi(request);
    const saved = await apiPostJsonStatus(request, token, "/api/sifen/csc", {
      idCsc: 12,
      csc: CSC_VALUE,
    });
    expect(saved.status).toBe(200);
    const rows = await apiGetJson<Array<{ idCsc: number; active: boolean }>>(
      request,
      token,
      "/api/sifen/csc",
    );
    expect(rows).toEqual([expect.objectContaining({ idCsc: 12, active: true })]);
  });
});
