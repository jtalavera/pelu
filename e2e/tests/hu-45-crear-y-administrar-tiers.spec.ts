import { expect, test } from "@playwright/test";
import { apiBaseUrl, authHeaders, loginPlatformAdminApi } from "../fixtures/api";
import { loginAsPlatformAdmin } from "../fixtures/auth";

// HU-45 · Crear y administrar Tiers
// requirements/multi-tenant/HU-45-crear-y-administrar-tiers.md

test.describe("HU-45 · Crear y administrar Tiers", () => {
  // AC-1: create a tier with a required, unique name and an optional description; it appears in
  // the listing immediately.
  test("AC1: Platform Admin creates a tier with name and description and sees it in the listing", async ({
    page,
  }) => {
    await loginAsPlatformAdmin(page);
    await page.getByRole("link", { name: "Tiers" }).click();
    await expect(page).toHaveURL(/\/platform\/tiers/);
    await expect(page.getByRole("heading", { name: "Tiers" })).toBeVisible();

    await page.getByRole("button", { name: "New tier" }).click();
    const dlg = page.getByRole("dialog", { name: "New tier" });
    await expect(dlg.getByLabel("Name")).toBeVisible();
    await expect(dlg.getByLabel("Description (optional)")).toBeVisible();

    const tierName = `E2E Tier ${Date.now()}`;
    await dlg.getByLabel("Name").fill(tierName);
    await dlg.getByLabel("Description (optional)").fill("Created by an automated test.");
    await dlg.getByRole("button", { name: "Create tier" }).click();

    await expect(dlg).toBeHidden();
    await expect(
      page.getByRole("alert").filter({ hasText: "Tier created successfully." }),
    ).toBeVisible();

    const row = page.locator("tr").filter({ hasText: tierName }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row).toContainText("Created by an automated test.");
    await expect(row).toContainText("0 tenants");
  });

  // AC-2: editing an existing tier's name and description persists and is reflected in the
  // listing right away.
  test("AC2: Platform Admin edits a tier's name and description", async ({ page }) => {
    await loginAsPlatformAdmin(page);
    await page.goto("/platform/tiers");

    const tierName = `E2E Editable ${Date.now()}`;
    await page.getByRole("button", { name: "New tier" }).click();
    const createDlg = page.getByRole("dialog", { name: "New tier" });
    await createDlg.getByLabel("Name").fill(tierName);
    await createDlg.getByRole("button", { name: "Create tier" }).click();
    await expect(createDlg).toBeHidden();

    const row = page.locator("tr").filter({ hasText: tierName }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click();

    const editDlg = page.getByRole("dialog", { name: "Edit tier" });
    const newName = `${tierName} Updated`;
    await editDlg.getByLabel("Name").fill(newName);
    await editDlg.getByLabel("Description (optional)").fill("Updated description.");
    await editDlg.getByRole("button", { name: "Save changes" }).click();

    await expect(editDlg).toBeHidden();
    await expect(
      page.getByRole("alert").filter({ hasText: "Tier updated successfully." }),
    ).toBeVisible();

    const updatedRow = page.locator("tr").filter({ hasText: newName }).first();
    await expect(updatedRow).toBeVisible({ timeout: 10_000 });
    await expect(updatedRow).toContainText("Updated description.");
  });

  // AC-5: creating (or renaming) a tier with a name already used by another tier is rejected with
  // a clear, field-level error; the dialog stays open.
  test("AC5: a duplicate tier name is rejected on create and on rename", async ({ page }) => {
    await loginAsPlatformAdmin(page);
    await page.goto("/platform/tiers");

    const baseName = `E2E Dup Base ${Date.now()}`;
    await page.getByRole("button", { name: "New tier" }).click();
    const createDlg = page.getByRole("dialog", { name: "New tier" });
    await createDlg.getByLabel("Name").fill(baseName);
    await createDlg.getByRole("button", { name: "Create tier" }).click();
    await expect(createDlg).toBeHidden();
    await expect(page.locator("tr").filter({ hasText: baseName }).first()).toBeVisible({
      timeout: 10_000,
    });

    // Duplicate on create.
    await page.getByRole("button", { name: "New tier" }).click();
    const dupDlg = page.getByRole("dialog", { name: "New tier" });
    await dupDlg.getByLabel("Name").fill(baseName);
    await dupDlg.getByRole("button", { name: "Create tier" }).click();
    await expect(dupDlg.locator("#tier-name-err")).toBeVisible();
    await expect(dupDlg.locator("#tier-name-err")).toHaveText(
      "That name is already used by another tier.",
    );
    await expect(dupDlg).toBeVisible();
    await dupDlg.getByRole("button", { name: "Cancel" }).click();

    // Duplicate on rename: create a second tier, then try to rename it to baseName.
    const secondName = `E2E Dup Second ${Date.now()}`;
    await page.getByRole("button", { name: "New tier" }).click();
    const secondDlg = page.getByRole("dialog", { name: "New tier" });
    await secondDlg.getByLabel("Name").fill(secondName);
    await secondDlg.getByRole("button", { name: "Create tier" }).click();
    await expect(secondDlg).toBeHidden();

    const secondRow = page.locator("tr").filter({ hasText: secondName }).first();
    await expect(secondRow).toBeVisible({ timeout: 10_000 });
    await secondRow.click();
    const editDlg = page.getByRole("dialog", { name: "Edit tier" });
    await editDlg.getByLabel("Name").fill(baseName);
    await editDlg.getByRole("button", { name: "Save changes" }).click();
    await expect(editDlg.locator("#tier-edit-name-err")).toBeVisible();
    await expect(editDlg.locator("#tier-edit-name-err")).toHaveText(
      "That name is already used by another tier.",
    );
    await expect(editDlg).toBeVisible();
  });

  // AC-1 (empty name rejected client-side, mirrors HU-37's tenant-name validation UX).
  test("An empty tier name is rejected with a clear error", async ({ page }) => {
    await loginAsPlatformAdmin(page);
    await page.goto("/platform/tiers");
    await page.getByRole("button", { name: "New tier" }).click();
    const dlg = page.getByRole("dialog", { name: "New tier" });

    await dlg.getByRole("button", { name: "Create tier" }).click();
    await expect(dlg.locator("#tier-name-err")).toBeVisible();
    await expect(dlg.locator("#tier-name-err")).toHaveText("Enter a name for the tier.");
    await expect(dlg).toBeVisible();
  });

  // AC-3: a tier with zero tenants assigned can be deleted successfully.
  test("AC3b: a tier with no tenants assigned can be deleted", async ({ page }) => {
    await loginAsPlatformAdmin(page);
    await page.goto("/platform/tiers");

    const tierName = `E2E Deletable ${Date.now()}`;
    await page.getByRole("button", { name: "New tier" }).click();
    const createDlg = page.getByRole("dialog", { name: "New tier" });
    await createDlg.getByLabel("Name").fill(tierName);
    await createDlg.getByRole("button", { name: "Create tier" }).click();
    await expect(createDlg).toBeHidden();

    const row = page.locator("tr").filter({ hasText: tierName }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.getByRole("button", { name: "Delete" }).click();

    const confirmDlg = page.getByRole("dialog", { name: "Delete tier?" });
    await expect(confirmDlg).toBeVisible();
    await confirmDlg.getByRole("button", { name: "Delete" }).click();

    await expect(page.getByTestId("tier-delete-success")).toBeVisible();
    await expect(page.locator("tr").filter({ hasText: tierName })).toHaveCount(0);
  });

  // AC-3: a tier currently assigned to at least one tenant cannot be deleted — the system shows a
  // clear message stating how many tenants use it.
  test("AC3a: deleting a tier in use by a tenant is rejected with a clear tenant-count message", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);

    const tierName = `E2E In-Use ${Date.now()}`;
    const createTierRes = await request.post(`${apiBaseUrl()}/api/platform/tiers`, {
      headers: authHeaders(platformToken),
      data: { name: tierName, description: null },
    });
    expect(createTierRes.ok(), await createTierRes.text()).toBeTruthy();
    const tier = (await createTierRes.json()) as { id: number; name: string };

    const createTenantRes = await request.post(`${apiBaseUrl()}/api/platform/tenants`, {
      headers: authHeaders(platformToken),
      data: { name: `E2E Tier Owner ${Date.now()}`, domain: null, tierId: tier.id },
    });
    expect(createTenantRes.ok(), await createTenantRes.text()).toBeTruthy();

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/tiers");

    const row = page.locator("tr").filter({ hasText: tierName }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row).toContainText("1 tenant");
    await row.getByRole("button", { name: "Delete" }).click();

    const confirmDlg = page.getByRole("dialog", { name: "Delete tier?" });
    await expect(confirmDlg).toBeVisible();
    await confirmDlg.getByRole("button", { name: "Delete" }).click();

    await expect(confirmDlg).toBeHidden();
    await expect(page.getByTestId("tier-delete-error")).toBeVisible();
    await expect(page.getByTestId("tier-delete-error")).toContainText(
      "1 tenant is currently assigned to it",
    );
    // Rejected: the tier is still in the listing.
    await expect(page.locator("tr").filter({ hasText: tierName }).first()).toBeVisible();
  });

  // AC-4: the listing shows every tier with how many tenants each one has.
  test("AC4: the listing shows every tier with its tenant count", async ({ page, request }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tierName = `E2E Listing ${Date.now()}`;
    const createTierRes = await request.post(`${apiBaseUrl()}/api/platform/tiers`, {
      headers: authHeaders(platformToken),
      data: { name: tierName, description: "Listing check." },
    });
    expect(createTierRes.ok(), await createTierRes.text()).toBeTruthy();

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/tiers");

    const row = page.locator("tr").filter({ hasText: tierName }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row).toContainText("Listing check.");
    await expect(row).toContainText("0 tenants");
  });
});
