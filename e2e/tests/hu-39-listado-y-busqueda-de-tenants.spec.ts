import { expect, test, type APIRequestContext } from "@playwright/test";
import { apiBaseUrl, authHeaders, loginPlatformAdminApi } from "../fixtures/api";
import { loginAsPlatformAdmin } from "../fixtures/auth";

// HU-39 · Listado y búsqueda de tenants
// requirements/multi-tenant/HU-39-listado-y-busqueda-de-tenants.md
//
// Depends on HU-37 (crear tenant, /platform/tenants + POST endpoint) and HU-38 (click-row-to-edit).
// AC-1 (columns) and AC-4 (row -> edit) are already covered by hu-37/hu-38 specs; this file focuses
// on what's new here: search (AC-2), pagination defaults (AC-3), empty-search state (AC-5), and
// the overflow-x-auto container (AC-6).

async function createTenantViaApi(
  request: APIRequestContext,
  platformToken: string,
  overrides: { name: string; domain?: string | null; tierId: number },
) {
  const res = await request.post(`${apiBaseUrl()}/api/platform/tenants`, {
    headers: authHeaders(platformToken),
    data: {
      name: overrides.name,
      domain: overrides.domain ?? null,
      tierId: overrides.tierId,
    },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as {
    id: number;
    name: string;
    domain: string | null;
    tierId: number;
    tierName: string;
    status: string;
  };
}

async function firstTierId(request: APIRequestContext, platformToken: string): Promise<number> {
  const tiersRes = await request.get(`${apiBaseUrl()}/api/platform/tenants/tiers`, {
    headers: authHeaders(platformToken),
  });
  expect(tiersRes.ok(), await tiersRes.text()).toBeTruthy();
  const tiers = (await tiersRes.json()) as Array<{ id: number; name: string }>;
  expect(tiers.length).toBeGreaterThan(0);
  return tiers[0].id;
}

test.describe("HU-39 · Listado y búsqueda de tenants", () => {
  // AC-1: the listing shows name, domain, tier, and status (Activo/Suspendido) for each tenant.
  test("AC1: the listing shows name, domain, tier, and status columns", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tierId = await firstTierId(request, platformToken);
    const stamp = Date.now();
    const tenant = await createTenantViaApi(request, platformToken, {
      name: `E2E Columns ${stamp}`,
      domain: `e2e-columns-${stamp}.pelu.app`,
      tierId,
    });

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/tenants");
    const row = page.getByTestId(`platform-tenant-row-${tenant.id}`);
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row).toContainText(tenant.name);
    await expect(row).toContainText(tenant.domain!);
    await expect(row).toContainText(tenant.tierName);
    await expect(row.getByText("Active", { exact: true })).toBeVisible();
  });

  // AC-2: the search field filters by name or domain, and submits on Enter (form onSubmit) as
  // well as via the Search button — no separate onKeyDown handler.
  test("AC2: search filters by partial name, by domain, and submits both on Enter and via the button", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tierId = await firstTierId(request, platformToken);
    const stamp = Date.now();
    const target = await createTenantViaApi(request, platformToken, {
      name: `E2E Zebra Salon ${stamp}`,
      domain: `e2e-zebra-${stamp}.pelu.app`,
      tierId,
    });
    const other = await createTenantViaApi(request, platformToken, {
      name: `E2E Other Salon ${stamp}`,
      domain: `e2e-other-${stamp}.pelu.app`,
      tierId,
    });

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/tenants");
    await expect(page.getByTestId(`platform-tenant-row-${target.id}`)).toBeVisible({
      timeout: 10_000,
    });

    const searchInput = page.getByLabel("Search by name or domain");

    // Search by partial name via the Search button.
    await searchInput.fill("Zebra Salon");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByTestId(`platform-tenant-row-${target.id}`)).toBeVisible();
    await expect(page.getByTestId(`platform-tenant-row-${other.id}`)).toHaveCount(0);

    // Clear and search by domain via Enter (no click on the button).
    await page.getByRole("button", { name: "Clear" }).click();
    await searchInput.fill(other.domain!);
    await searchInput.press("Enter");
    await expect(page.getByTestId(`platform-tenant-row-${other.id}`)).toBeVisible();
    await expect(page.getByTestId(`platform-tenant-row-${target.id}`)).toHaveCount(0);
  });

  // AC-3: 10/25/50 rows-per-page options, default 10, resolved server-side via Pagination +
  // PageSizeSelect.
  test("AC3: pagination defaults to 10 rows per page and offers 10/25/50, resolved server-side", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tierId = await firstTierId(request, platformToken);
    const stamp = Date.now();
    // Seed enough tenants (>10) that a second page exists, all sharing one unique search token so
    // this test's own assertions aren't polluted by tenants created by other specs.
    const token = `e2epag${stamp}`;
    for (let i = 0; i < 12; i++) {
      await createTenantViaApi(request, platformToken, {
        name: `E2E ${token} ${i}`,
        domain: null,
        tierId,
      });
    }

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/tenants");
    const searchInput = page.getByLabel("Search by name or domain");
    await searchInput.fill(token);
    await page.getByRole("button", { name: "Search", exact: true }).click();

    // Default page size is 10: exactly 10 of the 12 seeded rows are visible, "Next" page enabled.
    await expect(page.getByText(`1–10 of 12`)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(`tr[data-testid^="platform-tenant-row-"]`)).toHaveCount(10);

    // Switch page size to 25 (design-system PageSizeSelect): all 12 now fit on one page.
    await page.getByLabel("Rows per page:").selectOption("25");
    await expect(page.getByText(`1–12 of 12`)).toBeVisible();
    await expect(page.locator(`tr[data-testid^="platform-tenant-row-"]`)).toHaveCount(12);

    // Back to page size 10 and navigate to page 2 (design-system Pagination): remaining 2 rows.
    await page.getByLabel("Rows per page:").selectOption("10");
    await expect(page.getByText(`1–10 of 12`)).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText(`11–12 of 12`)).toBeVisible();
    await expect(page.locator(`tr[data-testid^="platform-tenant-row-"]`)).toHaveCount(2);
  });

  // AC-4: each row navigates to the tenant's edit form (HU-38) — already exercised end-to-end by
  // hu-38-editar-tenant.spec.ts; here we only confirm the row is reachable straight from a search
  // result.
  test("AC4: a searched-for row opens the edit dialog for that tenant", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tierId = await firstTierId(request, platformToken);
    const stamp = Date.now();
    const tenant = await createTenantViaApi(request, platformToken, {
      name: `E2E Reachable ${stamp}`,
      domain: null,
      tierId,
    });

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/tenants");
    const searchInput = page.getByLabel("Search by name or domain");
    await searchInput.fill(`Reachable ${stamp}`);
    await searchInput.press("Enter");

    const row = page.getByTestId(`platform-tenant-row-${tenant.id}`);
    await expect(row).toBeVisible();
    await row.click();
    const dlg = page.getByRole("dialog", { name: "Edit tenant" });
    await expect(dlg).toBeVisible();
    await expect(dlg.getByLabel("Name")).toHaveValue(tenant.name);
  });

  // AC-5: a search with no matches shows a clear message instead of an empty table.
  test("AC5: a search with no results shows a clear empty-state message", async ({ page }) => {
    await loginAsPlatformAdmin(page);
    await page.goto("/platform/tenants");
    const searchInput = page.getByLabel("Search by name or domain");
    const noMatchToken = `no-such-tenant-${Date.now()}`;
    await searchInput.fill(noMatchToken);
    await page.getByRole("button", { name: "Search", exact: true }).click();

    await expect(page.getByText(`No tenants match "${noMatchToken}".`)).toBeVisible();
    await expect(page.locator(`tr[data-testid^="platform-tenant-row-"]`)).toHaveCount(0);
  });

  // AC-6: the table lives inside an overflow-x-auto container for narrow viewports.
  test("AC6: the tenants table sits inside a horizontal-scroll container", async ({ page }) => {
    await loginAsPlatformAdmin(page);
    await page.setViewportSize({ width: 375, height: 720 });
    await page.goto("/platform/tenants");
    const table = page.locator("table").first();
    await expect(table).toBeVisible({ timeout: 10_000 });
    const scrollParentOverflowX = await table.evaluate((el) => {
      let node: HTMLElement | null = el.parentElement;
      while (node) {
        if (getComputedStyle(node).overflowX === "auto") return "auto";
        node = node.parentElement;
      }
      return null;
    });
    expect(scrollParentOverflowX).toBe("auto");
  });
});
