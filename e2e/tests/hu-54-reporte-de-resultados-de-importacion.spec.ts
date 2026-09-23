import { createHmac } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { apiBaseUrl, authHeaders, loginPlatformAdminApi } from "../fixtures/api";
import { loginAsPlatformAdmin } from "../fixtures/auth";

// servicios-import-mixto.xlsx (shared with HU-51's own tests) has one row ("Con Impuesto Valido")
// that references a tax named "IVA 10%" — it only imports successfully if that tax already exists
// in the destination tenant, same setup HU-51's AC3+AC4+AC5 test does.
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

async function createIva10Tax(
  request: import("@playwright/test").APIRequestContext,
  tenantId: number,
  userSuffix: string,
): Promise<void> {
  const forged = forgeTenantAdminToken(tenantId, userSuffix, `${userSuffix}@e2e.test`);
  const taxRes = await request.post(`${apiBaseUrl()}/api/taxes`, {
    headers: authHeaders(forged),
    data: { name: "IVA 10%", rate: 10 },
  });
  expect(taxRes.ok(), await taxRes.text()).toBeTruthy();
}

// HU-54 · Reporte de resultados de importación
// requirements/multi-tenant/HU-54-reporte-de-resultados-de-importacion.md
//
// Builds on HU-51/52/53's actual import flow (which already shows an immediate "N imported / M
// failed" result right after running) by persisting the outcome of every import attempt — success,
// partial, or whole-file rejection — server-side, and exposing a "last import report" section on
// the Platform Admin's "/platform/import" screen that stays available after leaving and returning,
// for all three importable entities.

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
const SERVICIOS_BASICO_XLSX = path.join(__dirname, "../fixtures/import/servicios-import-basico.xlsx");
const SERVICIOS_MIXTO_XLSX = path.join(__dirname, "../fixtures/import/servicios-import-mixto.xlsx");
const CLIENTES_BASICO_XLSX = path.join(__dirname, "../fixtures/import/clientes-import-basico.xlsx");
const PROFESIONALES_BASICO_XLSX = path.join(
  __dirname,
  "../fixtures/import/profesionales-import-basico.xlsx",
);

test.describe("HU-54 · Reporte de resultados de importación", () => {
  // AC-1 + AC-3: after an import with a mix of valid and invalid rows, the persisted "last report"
  // section shows the same processed/imported/failed summary as the immediate result, and the
  // failure of some rows did not stop the valid ones from importing.
  test("AC1+AC3: a mixed import's summary (processed/imported/failed) is reflected in the persisted last-report section", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tenant = await createTenant(request, platformToken, `E2E HU54 Mixto ${Date.now()}`);
    await createIva10Tax(request, tenant.id, "999995");

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/import");
    await page.getByTestId("import-tab-services").click();

    await page.locator("#import-run-tenant-services").selectOption({ value: String(tenant.id) });
    await page.locator("#import-run-file-services").setInputFiles(SERVICIOS_MIXTO_XLSX);
    await page.getByRole("button", { name: "Import" }).click();

    const immediateSummary = page.getByTestId("import-run-summary-services");
    await expect(immediateSummary).toBeVisible({ timeout: 15_000 });
    await expect(immediateSummary).toContainText("2 of 7 rows imported. 5 failed.");

    const reportSummary = page.getByTestId("import-last-report-summary-services");
    await expect(reportSummary).toBeVisible({ timeout: 15_000 });
    await expect(reportSummary).toContainText("2 of 7 rows imported. 5 failed.");
  });

  // AC-2: for each rejected row, the persisted report names the Excel row number and the specific
  // reason, in the same language as the rest of the UI (English in this test env).
  test("AC2: each failed row in the persisted report shows its row number and a specific reason", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tenant = await createTenant(request, platformToken, `E2E HU54 Detalle ${Date.now()}`);
    await createIva10Tax(request, tenant.id, "999994");

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/import");
    await page.getByTestId("import-tab-services").click();

    await page.locator("#import-run-tenant-services").selectOption({ value: String(tenant.id) });
    await page.locator("#import-run-file-services").setInputFiles(SERVICIOS_MIXTO_XLSX);
    await page.getByRole("button", { name: "Import" }).click();

    const table = page.getByTestId("import-last-report-table-services");
    await expect(table).toBeVisible({ timeout: 15_000 });

    // Row statuses: 2 imported, 5 failed (rows 2..8 of the fixture, row 1 is the header).
    const failedRows = table.locator("tbody tr", { hasText: "Failed" });
    await expect(failedRows).toHaveCount(5);
    const importedRows = table.locator("tbody tr", { hasText: "Imported" });
    await expect(importedRows).toHaveCount(2);

    await expect(table).toContainText("Price is not a valid number");
    await expect(table).toContainText("Price must be greater than zero");
    await expect(table).toContainText("Duration must be at least 1 minute");
    await expect(table).toContainText("does not exist for this tenant");
    await expect(table).toContainText("Duplicate row");
  });

  // AC-4: the report of the last import for a tenant/entity pair stays available after leaving the
  // import screen and coming back — not only right after the import finished.
  test("AC4: the last-import report is still available after navigating away and back", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tenant = await createTenant(request, platformToken, `E2E HU54 Persistencia ${Date.now()}`);

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/import");
    await page.getByTestId("import-tab-services").click();

    await page.locator("#import-run-tenant-services").selectOption({ value: String(tenant.id) });
    await page.locator("#import-run-file-services").setInputFiles(SERVICIOS_BASICO_XLSX);
    await page.getByRole("button", { name: "Import" }).click();

    await expect(page.getByTestId("import-run-summary-services")).toBeVisible({ timeout: 15_000 });

    // Leave the import screen entirely (a different platform route, unmounting the page and
    // resetting all of its local state), then come back.
    await page.getByRole("link", { name: "Tenants" }).click();
    await expect(page).toHaveURL(/\/platform\/tenants/);
    await page.getByRole("link", { name: "Data import" }).click();
    await expect(page).toHaveURL(/\/platform\/import/);
    await page.getByTestId("import-tab-services").click();

    // No file re-uploaded — only re-selecting the tenant this report belongs to.
    await page.locator("#import-run-tenant-services").selectOption({ value: String(tenant.id) });

    const reportSummary = page.getByTestId("import-last-report-summary-services");
    await expect(reportSummary).toBeVisible({ timeout: 15_000 });
    await expect(reportSummary).toContainText("2 of 2 rows imported. 0 failed.");
    await expect(page.getByTestId("import-last-report-meta-services")).toContainText(
      "servicios-import-basico.xlsx",
    );
  });

  // AC-5: the same persisted-report format (summary + file/date/who + per-row detail) is used for
  // clientes and profesionales imports too, not only servicios.
  test("AC5: the same report format is used for clientes and profesionales imports", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const clientTenant = await createTenant(request, platformToken, `E2E HU54 Clientes ${Date.now()}`);
    const proTenant = await createTenant(request, platformToken, `E2E HU54 Profesionales ${Date.now()}`);

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/import");

    await page.getByTestId("import-tab-clients").click();
    await page.locator("#import-run-tenant-clients").selectOption({ value: String(clientTenant.id) });
    await page.locator("#import-run-file-clients").setInputFiles(CLIENTES_BASICO_XLSX);
    await page.getByRole("button", { name: "Import" }).click();
    await expect(page.getByTestId("import-run-summary-clients")).toBeVisible({ timeout: 15_000 });
    const clientsReport = page.getByTestId("import-last-report-summary-clients");
    await expect(clientsReport).toBeVisible({ timeout: 15_000 });

    await page.getByTestId("import-tab-professionals").click();
    await page
      .locator("#import-run-tenant-professionals")
      .selectOption({ value: String(proTenant.id) });
    await page.locator("#import-run-file-professionals").setInputFiles(PROFESIONALES_BASICO_XLSX);
    await page.getByRole("button", { name: "Import" }).click();
    await expect(page.getByTestId("import-run-summary-professionals")).toBeVisible({
      timeout: 15_000,
    });
    const professionalsReport = page.getByTestId("import-last-report-summary-professionals");
    await expect(professionalsReport).toBeVisible({ timeout: 15_000 });
  });

  // Notes for estimación/pruebas: "importación con archivo inválido (rechazo total, HU-50 AC-5)
  // reflejada también en el reporte" — a whole-file rejection (here: wrong extension) is persisted
  // and shown in the last-report section just like a completed run.
  test("a whole-file rejection is also persisted and shown in the last-import report", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tenant = await createTenant(request, platformToken, `E2E HU54 Rechazo ${Date.now()}`);

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/import");
    await page.getByTestId("import-tab-services").click();
    await page.locator("#import-run-tenant-services").selectOption({ value: String(tenant.id) });

    const csvFile = {
      name: "servicios.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("categoria,nombre,precio,duracion_minutos\n"),
    };
    await page.locator("#import-run-file-services").setInputFiles(csvFile);
    await page.getByRole("button", { name: "Import" }).click();

    await expect(page.getByTestId("import-run-rejected-services")).toBeVisible({ timeout: 15_000 });

    const reportRejected = page.getByTestId("import-last-report-rejected-services");
    await expect(reportRejected).toBeVisible({ timeout: 15_000 });
    await expect(reportRejected).toContainText("Only .xlsx files are accepted");
  });
});
