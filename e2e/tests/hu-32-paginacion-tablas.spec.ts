/**
 * HU-32 · Server-side pagination for Services and Professionals tables.
 *
 * Covers every acceptance criterion:
 * 1. Page-size selector shows options 10/25/50, default 10.
 * 2. First page shows exactly 10 rows; range text is "1–10 of N".
 * 3. Prev disabled on page 1, Next enabled; clicking Next enables Prev.
 * 4. Changing page size resets to page 1.
 * 5. Typing in the search box resets to page 1 and narrows results.
 * 6. Pagination controls visible even when fewer than 10 rows are shown.
 */

import { test, expect, type APIRequestContext } from "@playwright/test";
import { loginAsDemo } from "../fixtures/auth";
import { apiPostJson, loginAsDemoApi } from "../fixtures/api";

// ── Seeding helpers ─────────────────────────────────────────────────────────

async function seedCategory(
  request: APIRequestContext,
  token: string,
  name: string,
): Promise<{ id: number }> {
  return apiPostJson<{ id: number }>(request, token, "/api/service-categories", {
    name,
    accentKey: "rose",
  });
}

async function seedServices(
  request: APIRequestContext,
  token: string,
  categoryId: number,
  count: number,
  prefix: string,
): Promise<void> {
  for (let i = 0; i < count; i++) {
    await apiPostJson(request, token, "/api/services", {
      name: `${prefix} Svc ${i} ${Date.now()}`,
      categoryId,
      priceMinor: 5000,
      durationMinutes: 30,
    });
  }
}

async function seedProfessionals(
  request: APIRequestContext,
  token: string,
  count: number,
  prefix: string,
): Promise<void> {
  for (let i = 0; i < count; i++) {
    await apiPostJson(request, token, "/api/professionals", {
      fullName: `${prefix} Prof ${i} ${Date.now()}`,
      phone: null,
      email: null,
      photoDataUrl: null,
    });
  }
}

// ── Services pagination ──────────────────────────────────────────────────────

test.describe("HU-32 – Services table pagination", () => {
  test("page-size selector shows 10/25/50 options (default 10)", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const cat = await seedCategory(request, token, `HU32-Cat-${Date.now()}`);
    await seedServices(request, token, cat.id, 11, "HU32");

    await loginAsDemo(page);
    await page.goto("/app/services");

    // Wait for the services tab to be active and data to load
    await expect(page.getByRole("button", { name: /^Services$/i })).toBeVisible();
    await page.waitForTimeout(600); // let debounce fire

    const select = page.getByLabel("Rows per page:");
    await expect(select).toBeVisible();
    await expect(select).toHaveValue("10");
    const options = select.locator("option");
    await expect(options).toHaveCount(3);
    await expect(options.nth(0)).toHaveText("10");
    await expect(options.nth(1)).toHaveText("25");
    await expect(options.nth(2)).toHaveText("50");
  });

  test("first page shows 10 rows and correct range text with >10 services", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const cat = await seedCategory(request, token, `HU32-Cat-${Date.now()}`);
    await seedServices(request, token, cat.id, 11, "HU32");

    await loginAsDemo(page);
    await page.goto("/app/services");
    await page.waitForTimeout(600);

    // Expect range text matching "1–10 of N" (N ≥ 11)
    await expect(page.getByText(/1–10 of \d+/)).toBeVisible({ timeout: 10_000 });
  });

  test("Prev disabled on page 1, Next enabled; clicking Next enables Prev", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    const cat = await seedCategory(request, token, `HU32-Cat-${Date.now()}`);
    await seedServices(request, token, cat.id, 11, "HU32");

    await loginAsDemo(page);
    await page.goto("/app/services");
    await page.waitForTimeout(600);

    await expect(page.getByText(/1–10 of \d+/)).toBeVisible({ timeout: 10_000 });

    const prevBtn = page.getByRole("button", { name: /previous/i });
    const nextBtn = page.getByRole("button", { name: /next/i });

    await expect(prevBtn).toBeDisabled();
    await expect(nextBtn).toBeEnabled();

    await nextBtn.click();
    await page.waitForTimeout(600);

    await expect(prevBtn).toBeEnabled();
  });

  test("changing page size resets to page 1", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    const cat = await seedCategory(request, token, `HU32-Cat-${Date.now()}`);
    await seedServices(request, token, cat.id, 11, "HU32");

    await loginAsDemo(page);
    await page.goto("/app/services");
    await page.waitForTimeout(600);

    await expect(page.getByText(/1–10 of \d+/)).toBeVisible({ timeout: 10_000 });

    // Go to page 2
    await page.getByRole("button", { name: /next/i }).click();
    await page.waitForTimeout(600);

    // Change page size to 25 – should reset to page 1
    const select = page.getByLabel("Rows per page:");
    await select.selectOption("25");
    await page.waitForTimeout(600);

    await expect(page.getByText(/^1–/)).toBeVisible({ timeout: 10_000 });
  });

  test("search resets to page 1 and narrows results", async ({ page, request }) => {
    const uniqueTag = `HU32Search${Date.now()}`;
    const token = await loginAsDemoApi(request);
    const cat = await seedCategory(request, token, `HU32-Cat-${Date.now()}`);
    await seedServices(request, token, cat.id, 11, "HU32Common");
    // Seed one uniquely named service
    await apiPostJson(request, token, "/api/services", {
      name: `${uniqueTag} UniqueService`,
      categoryId: cat.id,
      priceMinor: 5000,
      durationMinutes: 30,
    });

    await loginAsDemo(page);
    await page.goto("/app/services");
    await page.waitForTimeout(600);
    await expect(page.getByText(/1–10 of \d+/)).toBeVisible({ timeout: 10_000 });

    // Go to page 2 first
    await page.getByRole("button", { name: /next/i }).click();
    await page.waitForTimeout(600);

    // Search for the unique name – should reset to page 1
    await page.getByPlaceholder(/search by name/i).fill(uniqueTag);
    await page.waitForTimeout(600);

    // Should show "1–1 of 1"
    await expect(page.getByText(/^1–1 of 1$/)).toBeVisible({ timeout: 10_000 });
  });

  test("pagination controls are visible even with fewer than 10 rows", async ({
    page,
    request,
  }) => {
    const uniqueTag = `HU32FewItems${Date.now()}`;
    const token = await loginAsDemoApi(request);
    const cat = await seedCategory(request, token, `HU32-Cat-${Date.now()}`);
    await apiPostJson(request, token, "/api/services", {
      name: `${uniqueTag} Only`,
      categoryId: cat.id,
      priceMinor: 5000,
      durationMinutes: 30,
    });

    await loginAsDemo(page);
    await page.goto("/app/services");

    // Search for the unique name to get <10 results
    await page.getByPlaceholder(/search by name/i).fill(uniqueTag);
    await page.waitForTimeout(600);

    const select = page.getByLabel("Rows per page:");
    await expect(select).toBeVisible({ timeout: 10_000 });
    await expect(select).toHaveValue("10");
  });
});

// ── Professionals pagination ─────────────────────────────────────────────────

test.describe("HU-32 – Professionals table pagination", () => {
  test("page-size selector shows 10/25/50 options (default 10)", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    await seedProfessionals(request, token, 11, `HU32`);

    await loginAsDemo(page);
    await page.goto("/app/professionals");
    await page.waitForTimeout(600);

    const select = page.getByLabel("Rows per page:");
    await expect(select).toBeVisible({ timeout: 10_000 });
    await expect(select).toHaveValue("10");
    const options = select.locator("option");
    await expect(options).toHaveCount(3);
    await expect(options.nth(0)).toHaveText("10");
    await expect(options.nth(1)).toHaveText("25");
    await expect(options.nth(2)).toHaveText("50");
  });

  test("first page shows correct range text with >10 professionals", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await seedProfessionals(request, token, 11, `HU32`);

    await loginAsDemo(page);
    await page.goto("/app/professionals");
    await page.waitForTimeout(600);

    await expect(page.getByText(/1–10 of \d+/)).toBeVisible({ timeout: 10_000 });
  });

  test("Prev disabled on page 1, Next enabled; clicking Next enables Prev", async ({
    page,
    request,
  }) => {
    const token = await loginAsDemoApi(request);
    await seedProfessionals(request, token, 11, `HU32`);

    await loginAsDemo(page);
    await page.goto("/app/professionals");
    await page.waitForTimeout(600);

    await expect(page.getByText(/1–10 of \d+/)).toBeVisible({ timeout: 10_000 });

    const prevBtn = page.getByRole("button", { name: /previous/i });
    const nextBtn = page.getByRole("button", { name: /next/i });

    await expect(prevBtn).toBeDisabled();
    await expect(nextBtn).toBeEnabled();

    await nextBtn.click();
    await page.waitForTimeout(600);

    await expect(prevBtn).toBeEnabled();
  });

  test("changing page size resets to page 1", async ({ page, request }) => {
    const token = await loginAsDemoApi(request);
    await seedProfessionals(request, token, 11, `HU32`);

    await loginAsDemo(page);
    await page.goto("/app/professionals");
    await page.waitForTimeout(600);

    await expect(page.getByText(/1–10 of \d+/)).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /next/i }).click();
    await page.waitForTimeout(600);

    const select = page.getByLabel("Rows per page:");
    await select.selectOption("25");
    await page.waitForTimeout(600);

    await expect(page.getByText(/^1–/)).toBeVisible({ timeout: 10_000 });
  });

  test("search resets to page 1 and narrows results", async ({ page, request }) => {
    const uniqueTag = `HU32PSearch${Date.now()}`;
    const token = await loginAsDemoApi(request);
    await seedProfessionals(request, token, 11, "HU32Common");
    await apiPostJson(request, token, "/api/professionals", {
      fullName: `${uniqueTag} UniquePro`,
      phone: null,
      email: null,
      photoDataUrl: null,
    });

    await loginAsDemo(page);
    await page.goto("/app/professionals");
    await page.waitForTimeout(600);
    await expect(page.getByText(/1–10 of \d+/)).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /next/i }).click();
    await page.waitForTimeout(600);

    await page.getByPlaceholder(/search/i).fill(uniqueTag);
    await page.waitForTimeout(600);

    await expect(page.getByText(/^1–1 of 1$/)).toBeVisible({ timeout: 10_000 });
  });

  test("pagination controls are visible even with fewer than 10 rows", async ({
    page,
    request,
  }) => {
    const uniqueTag = `HU32PFew${Date.now()}`;
    const token = await loginAsDemoApi(request);
    await apiPostJson(request, token, "/api/professionals", {
      fullName: `${uniqueTag} OnlyOne`,
      phone: null,
      email: null,
      photoDataUrl: null,
    });

    await loginAsDemo(page);
    await page.goto("/app/professionals");

    await page.getByPlaceholder(/search/i).fill(uniqueTag);
    await page.waitForTimeout(600);

    const select = page.getByLabel("Rows per page:");
    await expect(select).toBeVisible({ timeout: 10_000 });
    await expect(select).toHaveValue("10");
  });
});
