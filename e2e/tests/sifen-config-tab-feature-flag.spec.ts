import { expect, test, type APIRequestContext } from "@playwright/test";
import { apiBaseUrl, authHeaders, loginPlatformAdminApi } from "../fixtures/api";
import { loginAsDemo } from "../fixtures/auth";

// The SIFEN section of Configuración (Configuración → SIFEN) must only be reachable when the
// `SIFEN_ELECTRONIC_INVOICING` feature flag resolves ON for the current tenant (HU-47 conjunctive
// resolution). When it's off: the "SIFEN" nav tab is hidden and a direct hit on
// /app/settings/sifen shows a "not enabled" message instead of the certificate management UI.

const DEMO_TENANT_ID = 1;
const FLAG_KEY = "SIFEN_ELECTRONIC_INVOICING";
const FEATURE_DISABLED_MSG = "Electronic invoicing (SIFEN) is not enabled for your business.";

async function setTenantFlag(request: APIRequestContext, enabled: boolean) {
  const token = await loginPlatformAdminApi(request);
  const res = await request.put(
    `${apiBaseUrl()}/api/admin/feature-flags/tenants/${DEMO_TENANT_ID}/${FLAG_KEY}`,
    { headers: authHeaders(token), data: { enabled } },
  );
  expect(res.ok(), await res.text()).toBeTruthy();
}

test.describe("Configuración → SIFEN · visible solo si el feature flag está habilitado", () => {
  test.afterEach(async ({ request }) => {
    // DEMO_TENANT_ID=1's baseline is an explicit tenant-level OFF override (e2e/global-setup.ts) —
    // restore that same baseline here rather than clearing to "inherit" (which would resolve to
    // the global default, ON since V53, since this tenant has no tier restriction). Every other
    // SIFEN spec follows this same per-test toggle convention (see
    // hu-33-ajustes-facturacion-electronica.spec.ts) and is self-contained — it turns the flag on
    // itself if it needs it, rather than depending on whatever a sibling spec happened to leave
    // behind. This file used to leave the tenant override cleared (inherit -> ON) specifically so
    // downstream sifen-hu-*/sifen-rt25 specs would find the flag on without setting it themselves —
    // that cross-file ordering dependency broke the moment anything reordered or interposed a spec
    // between this file and them (e.g. sifen-hu-22-activacion-por-tenant.spec.ts's own beforeEach
    // unconditionally forcing the flag off before every one of its tests), so those specs now
    // enable the flag themselves instead.
    await setTenantFlag(request, false);
  });

  test("con el flag SIFEN apagado, la sección SIFEN no está disponible", async ({ page, request }) => {
    await setTenantFlag(request, false);

    await loginAsDemo(page);
    await page.goto("/app/settings");

    // The nav tab is gone.
    await expect(page.getByRole("link", { name: "SIFEN" })).toHaveCount(0);

    // A direct URL shows the "not enabled" message, not the certificate UI.
    await page.goto("/app/settings/sifen");
    await expect(page.getByText(FEATURE_DISABLED_MSG)).toBeVisible();
    await expect(page.getByTestId("sifen-certificate-upload-section")).toHaveCount(0);
  });

  test("con el flag SIFEN encendido, la sección SIFEN se muestra", async ({ page, request }) => {
    await setTenantFlag(request, true);

    await loginAsDemo(page);
    await page.goto("/app/settings");

    const sifenTab = page.getByRole("link", { name: "SIFEN" });
    await expect(sifenTab).toBeVisible();
    await sifenTab.click();

    await expect(page).toHaveURL(/\/app\/settings\/sifen$/);
    await expect(page.getByTestId("sifen-certificate-upload-section")).toBeVisible();
    await expect(page.getByText(FEATURE_DISABLED_MSG)).toHaveCount(0);
  });
});
