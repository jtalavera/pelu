import { createHmac } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { apiBaseUrl, authHeaders, loginPlatformAdminApi } from "../fixtures/api";
import { loginAsPlatformAdmin } from "../fixtures/auth";

// HU-52 · Importar clientes desde Excel
// requirements/multi-tenant/HU-52-importar-clientes-desde-excel.md
//
// Extends HU-50's headers-only foundation into an actual upload -> parse data rows -> validate
// row-by-row -> persist flow for the "clientes" entity, exercised via the Platform Admin's
// "/platform/import" screen (clients tab). Mirrors HU-51's servicios import test (same UI, same
// per-row-independent semantics), swapping in clientes-specific validation (name required,
// per-tenant phone/email/RUC uniqueness, RUC format).

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
const BASICO_XLSX = path.join(__dirname, "../fixtures/import/clientes-import-basico.xlsx");
const MIXTO_XLSX = path.join(__dirname, "../fixtures/import/clientes-import-mixto.xlsx");
const AISLAMIENTO_XLSX = path.join(__dirname, "../fixtures/import/clientes-import-aislamiento.xlsx");

test.describe("HU-52 · Importar clientes desde Excel", () => {
  // AC-1: Platform Admin picks the destination tenant and uploads a .xlsx file (HU-50 format).
  // AC-5: a row with only nombre_completo filled in is valid (every other column is optional).
  // AC-6: imported clients are scoped exclusively to the chosen tenant.
  test("AC1+AC5+AC6: Platform Admin imports valid rows into the chosen tenant, blank optional fields allowed, scoped to that tenant only", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tenant = await createTenant(request, platformToken, `E2E Import Clientes Basico ${Date.now()}`);

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/import");
    await page.getByTestId("import-tab-clients").click();

    await page.locator("#import-run-tenant-clients").selectOption({ value: String(tenant.id) });
    await page.locator("#import-run-file-clients").setInputFiles(BASICO_XLSX);
    await page.getByRole("button", { name: "Import" }).click();

    const summary = page.getByTestId("import-run-summary-clients");
    await expect(summary).toBeVisible({ timeout: 15_000 });
    await expect(summary).toContainText("2 of 2 rows imported. 0 failed.");

    const forged = forgeTenantAdminToken(tenant.id, "999995", "e2e-import-clientes-basico@e2e.test");
    const clientsRes = await request.get(`${apiBaseUrl()}/api/clients`, { headers: authHeaders(forged) });
    expect(clientsRes.ok(), await clientsRes.text()).toBeTruthy();
    const clients = (await clientsRes.json()) as Array<{
      fullName: string;
      phone: string | null;
      email: string | null;
      ruc: string | null;
    }>;
    expect(clients).toHaveLength(2);

    const ana = clients.find((c) => c.fullName === "ANA BENITEZ");
    expect(ana).toBeTruthy();
    expect(ana?.phone ?? null).toBeNull();
    expect(ana?.email ?? null).toBeNull();
    expect(ana?.ruc ?? null).toBeNull();

    const carlos = clients.find((c) => c.fullName === "CARLOS DUARTE");
    expect(carlos).toBeTruthy();
    expect(carlos?.phone).toBe("0981123456");
    expect(carlos?.email).toBe("carlos.duarte@example.com");
    expect(carlos?.ruc).toBe("80000005-6");
  });

  // AC-2: a row without nombre_completo is rejected without stopping the rest of the file.
  // AC-3: a non-blank telefono/email/ruc that duplicates another row of the same file (which, for
  // this tenant, plays the role of "an existing client") is rejected row by row.
  // AC-4: an invalid RUC format rejects only that row.
  test("AC2+AC3+AC4: blank name, invalid RUC, and phone/email/RUC duplicates are rejected individually, valid rows still import", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tenant = await createTenant(request, platformToken, `E2E Import Clientes Mixto ${Date.now()}`);

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/import");
    await page.getByTestId("import-tab-clients").click();

    await page.locator("#import-run-tenant-clients").selectOption({ value: String(tenant.id) });
    await page.locator("#import-run-file-clients").setInputFiles(MIXTO_XLSX);
    await page.getByRole("button", { name: "Import" }).click();

    const summary = page.getByTestId("import-run-summary-clients");
    await expect(summary).toBeVisible({ timeout: 15_000 });
    await expect(summary).toContainText("2 of 7 rows imported. 5 failed.");

    const failedList = page.getByTestId("import-run-failed-rows-clients");
    await expect(failedList).toContainText("Missing client name.");
    await expect(failedList).toContainText(
      "Invalid RUC format. Use digits, hyphen, and digits (e.g. 80000005-6).",
    );
    await expect(failedList).toContainText("Another client of this tenant already has this phone number.");
    await expect(failedList).toContainText(
      "Another client of this tenant already has this email address.",
    );
    await expect(failedList).toContainText("Another client of this tenant already has this RUC.");

    const forged = forgeTenantAdminToken(tenant.id, "999994", "e2e-import-clientes-mixto@e2e.test");
    const clientsRes = await request.get(`${apiBaseUrl()}/api/clients`, { headers: authHeaders(forged) });
    expect(clientsRes.ok(), await clientsRes.text()).toBeTruthy();
    const clients = (await clientsRes.json()) as Array<{ fullName: string }>;
    expect(clients.map((c) => c.fullName).sort()).toEqual(
      ["CLIENTE VALIDO UNO", "CLIENTE VALIDO DOS"].sort(),
    );
  });

  // AC-6: the same telefono/email/ruc imported for two different tenants is accepted for both —
  // uniqueness is per-tenant, not global.
  test("AC6: identical phone/email/RUC imported into two different tenants is accepted for both (isolation)", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tenantA = await createTenant(request, platformToken, `E2E Import Clientes Aislamiento A ${Date.now()}`);
    const tenantB = await createTenant(request, platformToken, `E2E Import Clientes Aislamiento B ${Date.now()}`);

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/import");
    await page.getByTestId("import-tab-clients").click();

    for (const tenant of [tenantA, tenantB]) {
      await page.locator("#import-run-tenant-clients").selectOption({ value: String(tenant.id) });
      await page.locator("#import-run-file-clients").setInputFiles(AISLAMIENTO_XLSX);
      await page.getByRole("button", { name: "Import" }).click();

      const summary = page.getByTestId("import-run-summary-clients");
      await expect(summary).toBeVisible({ timeout: 15_000 });
      await expect(summary).toContainText("1 of 1 rows imported. 0 failed.");
    }

    const forgedA = forgeTenantAdminToken(tenantA.id, "999993", "e2e-import-clientes-aislamiento-a@e2e.test");
    const forgedB = forgeTenantAdminToken(tenantB.id, "999992", "e2e-import-clientes-aislamiento-b@e2e.test");

    const clientsARes = await request.get(`${apiBaseUrl()}/api/clients`, { headers: authHeaders(forgedA) });
    const clientsBRes = await request.get(`${apiBaseUrl()}/api/clients`, { headers: authHeaders(forgedB) });
    expect(clientsARes.ok(), await clientsARes.text()).toBeTruthy();
    expect(clientsBRes.ok(), await clientsBRes.text()).toBeTruthy();

    const clientsA = (await clientsARes.json()) as Array<{ fullName: string; ruc: string | null }>;
    const clientsB = (await clientsBRes.json()) as Array<{ fullName: string; ruc: string | null }>;
    expect(clientsA).toHaveLength(1);
    expect(clientsB).toHaveLength(1);
    expect(clientsA[0].fullName).toBe("CLIENTE COMPARTIDO");
    expect(clientsB[0].fullName).toBe("CLIENTE COMPARTIDO");
    expect(clientsA[0].ruc).toBe("80000005-6");
    expect(clientsB[0].ruc).toBe("80000005-6");
  });
});
