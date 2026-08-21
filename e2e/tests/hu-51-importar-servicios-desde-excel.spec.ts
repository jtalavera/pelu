import { createHmac } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { apiBaseUrl, authHeaders, loginPlatformAdminApi } from "../fixtures/api";
import { loginAsDemo, loginAsPlatformAdmin } from "../fixtures/auth";

// HU-51 · Importar catálogo de servicios desde Excel
// requirements/multi-tenant/HU-51-importar-servicios-desde-excel.md
//
// Extends HU-50's headers-only foundation into an actual upload -> parse data rows -> validate
// row-by-row -> persist flow for the "servicios" entity, exercised via the Platform Admin's
// "/platform/import" screen (services tab). Full formal per-row report UI is HU-54's separate
// scope — this only checks the immediate "N imported / M failed" result HU-51 itself requires.

const E2E_JWT_SECRET = "e2e-jwt-secret-min-32-characters-long!!";

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function forgeHs256Jwt(payload: Record<string, unknown>): string {
  const header = { alg: "HS256", typ: "JWT" };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = createHmac("sha256", E2E_JWT_SECRET).update(signingInput).digest();
  return `${signingInput}.${base64url(signature)}`;
}

function forgeTenantAdminToken(tenantId: number, sub: string, email: string): string {
  const now = Math.floor(Date.now() / 1000);
  return forgeHs256Jwt({ sub, email, role: "ADMIN", tid: tenantId, iat: now, exp: now + 3600 });
}

async function createTenant(
  request: import("@playwright/test").APIRequestContext,
  platformToken: string,
  name: string,
): Promise<{ id: number }> {
  const tiersRes = await request.get(`${apiBaseUrl()}/api/platform/tenants/tiers`, {
    headers: authHeaders(platformToken),
  });
  const tiers = (await tiersRes.json()) as Array<{ id: number; name: string }>;
  const createRes = await request.post(`${apiBaseUrl()}/api/platform/tenants`, {
    headers: authHeaders(platformToken),
    data: { name, domain: null, tierId: tiers[0].id },
  });
  expect(createRes.ok(), await createRes.text()).toBeTruthy();
  return (await createRes.json()) as { id: number };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASICO_XLSX = path.join(__dirname, "../fixtures/import/servicios-import-basico.xlsx");
const MIXTO_XLSX = path.join(__dirname, "../fixtures/import/servicios-import-mixto.xlsx");
const MONEDA_XLSX = path.join(__dirname, "../fixtures/import/servicios-import-moneda.xlsx");

test.describe("HU-51 · Importar catálogo de servicios desde Excel", () => {
  // AC-1: Platform Admin picks the destination tenant and uploads a .xlsx file (HU-50 format).
  // AC-2: a category referenced by a row that doesn't exist yet in the tenant is created
  // automatically before the service. AC-7: imported services are scoped exclusively to the
  // chosen tenant (a freshly created, empty tenant ends up with exactly the 2 imported services).
  test("AC1+AC2+AC7: Platform Admin imports valid rows into the chosen tenant, auto-creating missing categories, scoped to that tenant only", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tenant = await createTenant(request, platformToken, `E2E Import Basico ${Date.now()}`);

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/import");
    await page.getByTestId("import-tab-services").click();

    await page.locator("#import-run-tenant-services").selectOption({ value: String(tenant.id) });
    await page.locator("#import-run-file-services").setInputFiles(BASICO_XLSX);
    await page.getByRole("button", { name: "Import" }).click();

    const summary = page.getByTestId("import-run-summary-services");
    await expect(summary).toBeVisible({ timeout: 15_000 });
    await expect(summary).toContainText("2 of 2 rows imported. 0 failed.");

    const forged = forgeTenantAdminToken(tenant.id, "999997", "e2e-import-basico@e2e.test");

    const svcRes = await request.get(`${apiBaseUrl()}/api/services`, { headers: authHeaders(forged) });
    expect(svcRes.ok(), await svcRes.text()).toBeTruthy();
    const services = (await svcRes.json()) as Array<{ name: string; categoryName: string }>;
    expect(services).toHaveLength(2);
    expect(services.map((s) => s.name).sort()).toEqual(
      ["Coloracion completa", "Corte de dama"].sort(),
    );

    const catRes = await request.get(`${apiBaseUrl()}/api/service-categories`, {
      headers: authHeaders(forged),
    });
    expect(catRes.ok(), await catRes.text()).toBeTruthy();
    const categories = (await catRes.json()) as Array<{ name: string }>;
    expect(categories.map((c) => c.name).sort()).toEqual(["Color", "Corte"].sort());
  });

  // AC-3: non-numeric/negative/zero precio, or non-numeric/<1-minute duracion_minutos, rejects
  // only that row without stopping the rest of the file. AC-4: an impuesto naming a tax that
  // doesn't exist in the tenant rejects the row with a clear reason; a valid tax name is
  // associated with the created service. AC-5: two rows sharing the same nombre+categoria — only
  // the first is imported, the second is reported as a duplicate.
  test("AC3+AC4+AC5: invalid price/duration/tax rows are rejected individually with clear reasons, in-file duplicates are reported, valid rows still import", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tenant = await createTenant(request, platformToken, `E2E Import Mixto ${Date.now()}`);
    const forged = forgeTenantAdminToken(tenant.id, "999996", "e2e-import-mixto@e2e.test");

    const taxRes = await request.post(`${apiBaseUrl()}/api/taxes`, {
      headers: authHeaders(forged),
      data: { name: "IVA 10%", rate: 10 },
    });
    expect(taxRes.ok(), await taxRes.text()).toBeTruthy();

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/import");
    await page.getByTestId("import-tab-services").click();

    await page.locator("#import-run-tenant-services").selectOption({ value: String(tenant.id) });
    await page.locator("#import-run-file-services").setInputFiles(MIXTO_XLSX);
    await page.getByRole("button", { name: "Import" }).click();

    const summary = page.getByTestId("import-run-summary-services");
    await expect(summary).toBeVisible({ timeout: 15_000 });
    await expect(summary).toContainText("2 of 7 rows imported. 5 failed.");

    const failedList = page.getByTestId("import-run-failed-rows-services");
    await expect(failedList).toContainText("Price is not a valid number");
    await expect(failedList).toContainText("Price must be greater than zero");
    await expect(failedList).toContainText("Duration must be at least 1 minute");
    await expect(failedList).toContainText("does not exist for this tenant");
    await expect(failedList).toContainText("Duplicate row");

    const svcRes = await request.get(`${apiBaseUrl()}/api/services`, { headers: authHeaders(forged) });
    expect(svcRes.ok(), await svcRes.text()).toBeTruthy();
    const services = (await svcRes.json()) as Array<{ name: string; taxName: string | null }>;
    expect(services.map((s) => s.name).sort()).toEqual(
      ["Con Impuesto Valido", "Servicio Valido"].sort(),
    );
    const withTax = services.find((s) => s.name === "Con Impuesto Valido");
    expect(withTax?.taxName).toBe("IVA 10%");
    const withoutTax = services.find((s) => s.name === "Servicio Valido");
    expect(withoutTax?.taxName ?? null).toBeNull();
  });

  // AC-6: once imported, a service displays with the same currency format as the rest of the app
  // (thousands separated by ".", no decimals) — checked on the real Services page as a logged-in
  // tenant user, not just via the raw stored value.
  test("AC6: an imported service displays with the same currency format as the rest of the app", async ({
    page,
  }) => {
    await loginAsPlatformAdmin(page);
    await page.goto("/platform/import");
    await page.getByTestId("import-tab-services").click();

    // Tenant id 1 is the seeded DEMO tenant (FemmeDataInitializer) — logging in through the
    // browser as its admin afterwards is the only realistic way to exercise the real
    // ServicesPage rendering path (see HU-41's e2e test for why: tenant login resolves by
    // Origin/domain, defaulting to DEMO — a freshly created tenant's own domain isn't reachable
    // from this test's origin).
    await page.locator("#import-run-tenant-services").selectOption({ value: "1" });
    await page.locator("#import-run-file-services").setInputFiles(MONEDA_XLSX);
    await page.getByRole("button", { name: "Import" }).click();

    const summary = page.getByTestId("import-run-summary-services");
    await expect(summary).toBeVisible({ timeout: 15_000 });
    await expect(summary).toContainText("1 of 1 rows imported. 0 failed.");

    await loginAsDemo(page);
    await page.goto("/app/services");
    await page.locator("#services-list-filter").fill("Formato Moneda E2E");

    const row = page.locator("tr").filter({ hasText: "Servicio Formato Moneda E2E" });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText("Gs. 175.000");
  });
});
