import { expect, test, type APIRequestContext } from "@playwright/test";
import { apiBaseUrl, authHeaders, loginPlatformAdminApi } from "../fixtures/api";
import { loginAsDemo, loginAsPlatformAdmin } from "../fixtures/auth";

// HU-49 · Configuración global y per-tenant de feature flags
// requirements/multi-tenant/HU-49-configuracion-global-y-per-tenant-de-feature-flags.md
//
// Revisión 2026-09-10: el default global se edita en su propia vista "Funcionalidades Globales"
// (/platform/global-feature-flags); la vista por tenant lo muestra en solo lectura. Ambas vistas
// son solo para PLATFORM_ADMIN.

const GUIDED_TOUR = "GUIDED_TOUR";

async function getGlobalFlag(request: APIRequestContext, token: string, flagKey: string) {
  const res = await request.get(`${apiBaseUrl()}/api/admin/feature-flags`, {
    headers: authHeaders(token),
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const rows = (await res.json()) as Array<{ flagKey: string; enabled: boolean }>;
  return rows.find((r) => r.flagKey === flagKey);
}

test.describe("HU-49 · Funcionalidades Globales", () => {
  // AC-1: the Platform Admin sees and modifies the platform-wide default of each flag.
  test("AC1: a Platform Admin toggles a global flag and the backend reflects it", async ({
    page,
    request,
  }) => {
    const token = await loginPlatformAdminApi(request);
    const before = await getGlobalFlag(request, token, GUIDED_TOUR);
    expect(before, "GUIDED_TOUR must be seeded").toBeTruthy();

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/global-feature-flags");
    await expect(page.getByRole("heading", { name: "Global feature flags" })).toBeVisible();

    const row = page.getByTestId(`global-flag-row-${GUIDED_TOUR}`);
    await expect(row).toBeVisible();
    const toggle = page.locator(`#global-flag-${GUIDED_TOUR}`);
    await expect(toggle).toBeChecked({ checked: before!.enabled });

    await toggle.click({ force: true });

    await expect
      .poll(async () => (await getGlobalFlag(request, token, GUIDED_TOUR))?.enabled)
      .toBe(!before!.enabled);

    // Restore so the shared H2 keeps its seeded state for other specs.
    await toggle.click({ force: true });
    await expect
      .poll(async () => (await getGlobalFlag(request, token, GUIDED_TOUR))?.enabled)
      .toBe(before!.enabled);
  });

  // AC-2: the per-tenant view ("Funcionalidades Tenants") shows the global default read-only and
  // links to the Global feature flags page to edit it.
  test("AC2: the tenant view shows the global default read-only with an edit link", async ({
    page,
  }) => {
    await loginAsPlatformAdmin(page);
    await page.goto("/platform/feature-flags");
    await page.getByLabel("Organization").fill("Demo salon");
    await page.getByRole("button", { name: /Demo salon/ }).click();
    await expect(page.getByText(GUIDED_TOUR)).toBeVisible();

    // No global toggle on this page.
    await expect(page.locator(`#ff-global-${GUIDED_TOUR}`)).toHaveCount(0);

    const link = page.getByRole("link", { name: "Edit in Global feature flags →" }).first();
    await link.click();
    await expect(page).toHaveURL(/\/platform\/global-feature-flags/);
    await expect(page.getByRole("heading", { name: "Global feature flags" })).toBeVisible();
  });

  // AC-5 (solo lectura para el resto de roles): a tenant admin hitting the global-flags route by
  // URL is redirected out of the platform area.
  test("AC5: a tenant admin cannot reach the Global feature flags page", async ({ page }) => {
    await loginAsDemo(page);
    await page.goto("/platform/global-feature-flags");
    await expect(page).toHaveURL(/\/app/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Global feature flags" })).toHaveCount(0);
  });
});
