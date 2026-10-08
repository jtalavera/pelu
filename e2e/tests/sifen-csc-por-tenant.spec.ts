import { expect, test } from "@playwright/test";
import {
  API_BASE,
  apiGetJson,
  apiPostJsonStatus,
  authHeaders,
  loginAsDemoApi,
  loginPlatformAdminApi,
  setTenantFeatureFlag,
} from "../fixtures/api";
import { loginAsDemo, loginAsPlatformAdmin } from "../fixtures/auth";
import { openTenantSifenAsRoot } from "../fixtures/sifenRoot";

// Per-tenant CSC (Código de Seguridad del Contribuyente): the DNIT issues each taxpayer its own CSC
// and validates every invoice QR with it. It is loaded ONLY by the platform's root user
// (Plataforma → Salones → SIFEN) — the salon's administrator sees it read-only in Configuración →
// SIFEN → "Security code (CSC)". The value is a secret: write-only — never shown again, never
// returned by the API. Cross-tenant isolation (lists, activation, same IdCSC in two salons) is
// covered by tests/mt-isolation/mt-sifen.spec.ts (scenario 7); the hash itself by
// SifenQrCodeServiceTest / SifenDocumentSigningServiceTest.

const DEMO_TENANT_ID = 1;
const SIFEN_FLAG_KEY = "SIFEN_ELECTRONIC_INVOICING";
const CSC_VALUE = "A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6";
const CSC_VALUE_2 = "Z9Y8X7W6V5U4T3S2R1Q0P9O8N7M6L5K4";
const ROOT_CSC_PATH = `/api/platform/tenants/${DEMO_TENANT_ID}/sifen/csc`;

type Page = import("@playwright/test").Page;
type Request = import("@playwright/test").APIRequestContext;

async function clearCsc(request: Request) {
  const res = await request.post(`${API_BASE}/api/admin/sifen-test-support/csc/clear`);
  expect(res.ok(), await res.text()).toBeTruthy();
}

async function loadCsc(page: Page, idCsc: string, csc: string) {
  await page.locator("#sifen-csc-id").fill(idCsc);
  await page.locator("#sifen-csc-value").fill(csc);
  await page.getByRole("button", { name: "Save security code" }).click();
}

/** Root user on Plataforma → Salones → (demo) → SIFEN, CSC section ready. */
async function openCscAsRoot(page: Page) {
  await openTenantSifenAsRoot(page, DEMO_TENANT_ID);
  await expect(page.getByTestId("sifen-csc-section")).toBeVisible();
  await expect(page.getByTestId("sifen-csc-form-card")).toBeVisible();
}

test.describe("SIFEN · CSC por salón (cargado solo por el usuario root)", () => {
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

  test("CSC · 1 el root llega desde el diálogo del salón; la pantalla está vacía y avisa que se usa el CSC de prueba (TEST)", async ({
    page,
  }) => {
    await loginAsPlatformAdmin(page);
    await page.goto("/platform/tenants");
    // Other specs create many tenants, so the demo salon may not be on the first page: search it.
    const search = page.getByLabel("Search by name or domain");
    await search.fill("Demo salon");
    await search.press("Enter");
    await page.getByTestId(`platform-tenant-row-${DEMO_TENANT_ID}`).click();
    await page.getByTestId("platform-tenant-sifen-link").click();
    await expect(page).toHaveURL(new RegExp(`/platform/tenants/${DEMO_TENANT_ID}/sifen$`));

    await expect(page.getByTestId("sifen-csc-form-card")).toBeVisible();
    await expect(page.getByTestId("sifen-csc-empty")).toBeVisible();
    await expect(page.getByTestId("sifen-csc-test-fallback")).toBeVisible();
    await expect(page.getByTestId("sifen-csc-missing-production")).toHaveCount(0);
    // The CSC is typed into a password field (never echoed back).
    await expect(page.locator("#sifen-csc-value")).toHaveAttribute("type", "password");
  });

  test("CSC · 2 valida el IdCSC y el formato del CSC, con ejemplo concreto", async ({ page }) => {
    await openCscAsRoot(page);

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
    await openCscAsRoot(page);

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
    // … nor in what the API returns (to the root user or to the salon).
    const rootToken = await loginPlatformAdminApi(request);
    const rootRows = await apiGetJson<Array<{ idCsc: number; active: boolean }>>(
      request,
      rootToken,
      ROOT_CSC_PATH,
    );
    expect(rootRows).toHaveLength(1);
    expect(rootRows[0]).toMatchObject({ idCsc: 5, active: true });
    const tenantToken = await loginAsDemoApi(request);
    const tenantRows = await apiGetJson<unknown[]>(request, tenantToken, "/api/sifen/csc");
    expect(JSON.stringify(rootRows)).not.toContain(CSC_VALUE);
    expect(JSON.stringify(tenantRows)).not.toContain(CSC_VALUE);

    // It survives a reload (persisted, not just client state).
    await page.reload();
    await expect(page.getByTestId("sifen-csc-row-5")).toContainText("Active");
  });

  test("CSC · 4 un segundo CSC queda inactivo hasta que se lo activa; solo hay uno activo", async ({
    page,
  }) => {
    await openCscAsRoot(page);
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
    await openCscAsRoot(page);
    await loadCsc(page, "5", CSC_VALUE);
    await expect(page.getByTestId("sifen-csc-row-5")).toBeVisible();

    await loadCsc(page, "5", CSC_VALUE_2);

    await expect(page.getByTestId("sifen-csc-saved")).toContainText("was replaced");
    await expect(page.locator('[data-testid^="sifen-csc-row-"]')).toHaveCount(1);
    await expect(page.getByTestId("sifen-csc-row-5")).toContainText("Active");
  });

  test("CSC · 6 el administrador del salón solo ve el CSC (sin formulario ni activar) y lo ve cargado por el root", async ({
    page,
    request,
  }) => {
    // The root user loads two CSCs …
    const rootToken = await loginPlatformAdminApi(request);
    for (const [idCsc, csc] of [
      [5, CSC_VALUE],
      [6, CSC_VALUE_2],
    ] as const) {
      const res = await apiPostJsonStatus(request, rootToken, ROOT_CSC_PATH, { idCsc, csc });
      expect(res.status, res.text).toBe(200);
    }

    // … and the salon's administrator only LOOKS.
    await loginAsDemo(page);
    await page.goto("/app/settings/sifen");
    await page.getByRole("tab", { name: "Security code (CSC)" }).click();

    await expect(page.getByTestId("sifen-csc-row-5")).toContainText("Active");
    await expect(page.getByTestId("sifen-csc-row-6")).toContainText("Inactive");
    await expect(page.getByTestId("sifen-csc-readonly-note")).toBeVisible();
    await expect(page.getByTestId("sifen-csc-form-card")).toHaveCount(0);
    await expect(page.locator("#sifen-csc-value")).toHaveCount(0);
    await expect(page.getByTestId("sifen-csc-activate-6")).toHaveCount(0);
    expect(await page.content()).not.toContain(CSC_VALUE);
  });

  test("CSC · 7 la API: solo el root escribe (el admin del salón recibe 405/403) y rechaza valores inválidos", async ({
    request,
  }) => {
    const tenantToken = await loginAsDemoApi(request);
    const rootToken = await loginPlatformAdminApi(request);

    // The salon's admin: no tenant-side write endpoint; the platform one is closed to them.
    expect([403, 405]).toContain(
      (await apiPostJsonStatus(request, tenantToken, "/api/sifen/csc", { idCsc: 5, csc: CSC_VALUE }))
        .status,
    );
    expect(
      (await apiPostJsonStatus(request, tenantToken, ROOT_CSC_PATH, { idCsc: 5, csc: CSC_VALUE }))
        .status,
    ).toBe(403);
    expect((await apiPostJsonStatus(request, tenantToken, `${ROOT_CSC_PATH}/5/activate`, {})).status).toBe(
      403,
    );
    const rows = await request.get(`${API_BASE}${ROOT_CSC_PATH}`, { headers: authHeaders(tenantToken) });
    expect(rows.status()).toBe(403);

    // The root user: validation with error codes, 404s.
    const badId = await apiPostJsonStatus(request, rootToken, ROOT_CSC_PATH, {
      idCsc: 10000,
      csc: CSC_VALUE,
    });
    expect(badId.status).toBe(400);
    expect(badId.text).toContain("INVALID_CSC_ID");
    for (const bad of ["", "TOO-SHORT", `${CSC_VALUE}X`, "A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5-6"]) {
      const res = await apiPostJsonStatus(request, rootToken, ROOT_CSC_PATH, { idCsc: 5, csc: bad });
      expect(res.status, bad).toBe(400);
      expect(res.text).toContain("INVALID_CSC_FORMAT");
    }
    const notFound = await apiPostJsonStatus(request, rootToken, `${ROOT_CSC_PATH}/77/activate`, {});
    expect(notFound.status).toBe(404);
    expect(notFound.text).toContain("CSC_NOT_FOUND");
    const noTenant = await request.get(`${API_BASE}/api/platform/tenants/999999999/sifen/csc`, {
      headers: authHeaders(rootToken),
    });
    expect(noTenant.status()).toBe(404);

    expect(await apiGetJson<unknown[]>(request, rootToken, ROOT_CSC_PATH)).toEqual([]); // nothing stored
  });

  test("CSC · 8 el cambio de CSC no requiere deploy: se carga y queda disponible al instante", async ({
    request,
  }) => {
    // Loading a CSC is plain tenant configuration (DB row + secret store) — the same running
    // backend serves the new value on the next request, with no redeploy or restart.
    const rootToken = await loginPlatformAdminApi(request);
    const saved = await apiPostJsonStatus(request, rootToken, ROOT_CSC_PATH, {
      idCsc: 12,
      csc: CSC_VALUE,
    });
    expect(saved.status).toBe(200);
    const tenantToken = await loginAsDemoApi(request);
    const rows = await apiGetJson<Array<{ idCsc: number; active: boolean }>>(
      request,
      tenantToken,
      "/api/sifen/csc",
    );
    expect(rows).toEqual([expect.objectContaining({ idCsc: 12, active: true })]);
  });
});
