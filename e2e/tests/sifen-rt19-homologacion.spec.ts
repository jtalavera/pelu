import { expect, test, type APIRequestContext } from "@playwright/test";
import { apiBaseUrl, authHeaders, loginPlatformAdminApi } from "../fixtures/api";
import { PLATFORM_ADMIN_EMAIL, loginAsPlatformAdmin } from "../fixtures/auth";

// RT-19 (Hardening_SIFEN.md): an explicit per-tenant SIFEN homologación status (PENDING/APPROVED),
// informative for the Platform Admin deciding whether to rely on SIFEN_ELECTRONIC_INVOICING in
// production — deliberately not a hard gate on the flag itself (see
// SifenHomologationStatus's own javadoc), since a tenant may legitimately need the flag on in the
// TEST SIFEN environment before homologación completes.
//
// HU-36: the legacy tenant-bound SYSTEM_ADMIN role was migrated to the tenant-independent
// PLATFORM_ADMIN role, and the toggle/homologación admin UI moved from
// /app/settings/feature-flags to /platform/feature-flags (Platform Admin now picks the target
// tenant explicitly via a search field instead of an implicit preview tenant).

const DEMO_TENANT_ID = 1;
// e2e/global-setup.ts always names the first (id=1) provisioned tenant this.
const DEMO_TENANT_NAME = "Demo salon";

async function setHomologationStatus(request: APIRequestContext, status: "PENDING" | "APPROVED") {
  const token = await loginPlatformAdminApi(request);
  const res = await request.put(
    `${apiBaseUrl()}/api/admin/feature-flags/tenants/${DEMO_TENANT_ID}/sifen-homologation`,
    { headers: authHeaders(token), data: { status } },
  );
  expect(res.ok(), await res.text()).toBeTruthy();
}

async function goToTenantFeatureFlags(page: import("@playwright/test").Page) {
  await loginAsPlatformAdmin(page);
  await page.goto("/platform/feature-flags");
  await page.getByLabel("Organization").fill(DEMO_TENANT_NAME);
  await page.getByRole("button", { name: new RegExp(DEMO_TENANT_NAME) }).click();
}

test.describe("RT-19 · Estado de homologación SIFEN por tenant", () => {
  test.beforeEach(async ({ request }) => {
    await setHomologationStatus(request, "PENDING");
  });

  test("RT-19 · muestra Pendiente y una advertencia junto al flag mientras no está aprobada", async ({
    page,
  }) => {
    await goToTenantFeatureFlags(page);

    await expect(page.getByText("SIFEN homologación", { exact: true })).toBeVisible();
    await expect(page.getByText("Pending", { exact: true })).toBeVisible();
    await expect(
      page.getByText(/not marked as having completed SIFEN homologación/),
    ).toBeVisible();
  });

  test("RT-19 · un Platform Admin marca la homologación como aprobada y la advertencia desaparece", async ({
    page,
  }) => {
    await goToTenantFeatureFlags(page);

    await page.getByRole("button", { name: "Mark as approved" }).click();

    await expect(page.getByText("Approved", { exact: true })).toBeVisible();
    // Scoped, not page-wide: other specs sharing this H2 instance (e.g. sifen-hu-22) can leave a
    // feature-flag-change history entry that also contains PLATFORM_ADMIN_EMAIL, and a page-wide
    // match would hit that ambiguously (strict mode violation) instead of this marker specifically.
    await expect(
      page.getByText(new RegExp(`Marked Approved by ${PLATFORM_ADMIN_EMAIL}`)),
    ).toBeVisible();
    await expect(
      page.getByText(/not marked as having completed SIFEN homologación/),
    ).toHaveCount(0);
  });

  test("RT-19 · marcar como pendiente nuevamente vuelve a mostrar la advertencia", async ({
    page,
    request,
  }) => {
    await setHomologationStatus(request, "APPROVED");
    await goToTenantFeatureFlags(page);
    await expect(page.getByText("Approved", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Mark as pending" }).click();

    await expect(page.getByText("Pending", { exact: true })).toBeVisible();
    await expect(
      page.getByText(/not marked as having completed SIFEN homologación/),
    ).toBeVisible();
  });
});
