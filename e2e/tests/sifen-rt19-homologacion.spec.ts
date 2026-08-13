import { expect, test, type APIRequestContext } from "@playwright/test";
import { apiBaseUrl, authHeaders } from "../fixtures/api";
import { loginAs } from "../fixtures/auth";

// RT-19 (Hardening_SIFEN.md): an explicit per-tenant SIFEN homologación status (PENDING/APPROVED),
// informative for the SYSTEM_ADMIN deciding whether to rely on SIFEN_ELECTRONIC_INVOICING in
// production — deliberately not a hard gate on the flag itself (see
// SifenHomologationStatus's own javadoc), since a tenant may legitimately need the flag on in the
// TEST SIFEN environment before homologación completes.

const SYS_ADMIN_EMAIL = "root@pelu";
const SYS_ADMIN_PASSWORD = ".The.Super@admin.1982";
const DEMO_TENANT_ID = 1;

async function loginSystemAdminApi(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${apiBaseUrl()}/api/auth/login`, {
    data: { email: SYS_ADMIN_EMAIL, password: SYS_ADMIN_PASSWORD },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const json = (await res.json()) as { accessToken: string };
  return json.accessToken;
}

async function setHomologationStatus(request: APIRequestContext, status: "PENDING" | "APPROVED") {
  const token = await loginSystemAdminApi(request);
  const res = await request.put(
    `${apiBaseUrl()}/api/admin/feature-flags/tenants/${DEMO_TENANT_ID}/sifen-homologation`,
    { headers: authHeaders(token), data: { status } },
  );
  expect(res.ok(), await res.text()).toBeTruthy();
}

test.describe("RT-19 · Estado de homologación SIFEN por tenant", () => {
  test.beforeEach(async ({ request }) => {
    await setHomologationStatus(request, "PENDING");
  });

  test("RT-19 · muestra Pendiente y una advertencia junto al flag mientras no está aprobada", async ({
    page,
  }) => {
    await loginAs(page, SYS_ADMIN_EMAIL, SYS_ADMIN_PASSWORD);
    await page.goto("/app/settings/feature-flags");

    await expect(page.getByText("SIFEN homologación", { exact: true })).toBeVisible();
    await expect(page.getByText("Pending", { exact: true })).toBeVisible();
    await expect(
      page.getByText(/not marked as having completed SIFEN homologación/),
    ).toBeVisible();
  });

  test("RT-19 · un system admin marca la homologación como aprobada y la advertencia desaparece", async ({
    page,
  }) => {
    await loginAs(page, SYS_ADMIN_EMAIL, SYS_ADMIN_PASSWORD);
    await page.goto("/app/settings/feature-flags");

    await page.getByRole("button", { name: "Mark as approved" }).click();

    await expect(page.getByText("Approved", { exact: true })).toBeVisible();
    // Scoped, not page-wide: other specs sharing this H2 instance (e.g. sifen-hu-22) can leave a
    // feature-flag-change history entry that also contains SYS_ADMIN_EMAIL, and a page-wide match
    // would hit that ambiguously (strict mode violation) instead of this marker specifically.
    await expect(page.getByText(new RegExp(`Marked Approved by ${SYS_ADMIN_EMAIL}`))).toBeVisible();
    await expect(
      page.getByText(/not marked as having completed SIFEN homologación/),
    ).toHaveCount(0);
  });

  test("RT-19 · marcar como pendiente nuevamente vuelve a mostrar la advertencia", async ({
    page,
    request,
  }) => {
    await setHomologationStatus(request, "APPROVED");
    await loginAs(page, SYS_ADMIN_EMAIL, SYS_ADMIN_PASSWORD);
    await page.goto("/app/settings/feature-flags");
    await expect(page.getByText("Approved", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Mark as pending" }).click();

    await expect(page.getByText("Pending", { exact: true })).toBeVisible();
    await expect(
      page.getByText(/not marked as having completed SIFEN homologación/),
    ).toBeVisible();
  });
});
