import { createHmac } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { apiBaseUrl, authHeaders, loginPlatformAdminApi } from "../fixtures/api";
import { loginAsPlatformAdmin } from "../fixtures/auth";

// HU-53 · Importar profesionales desde Excel
// requirements/multi-tenant/HU-53-importar-profesionales-desde-excel.md
//
// Extends HU-50's headers-only foundation into an actual upload -> parse data rows -> validate
// row-by-row -> persist flow for the "profesionales" entity, exercised via the Platform Admin's
// "/platform/import" screen (professionals tab). Mirrors HU-51/HU-52's servicios/clientes import
// tests (same UI, same per-row-independent semantics), swapping in profesionales-specific
// validation (name required, no PIN/system access, active-by-default, phone/email format reused
// from manual creation, per-tenant email uniqueness).

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
const BASICO_XLSX = path.join(__dirname, "../fixtures/import/profesionales-import-basico.xlsx");
const MIXTO_XLSX = path.join(__dirname, "../fixtures/import/profesionales-import-mixto.xlsx");
const AISLAMIENTO_XLSX = path.join(
  __dirname,
  "../fixtures/import/profesionales-import-aislamiento.xlsx",
);

test.describe("HU-53 · Importar profesionales desde Excel", () => {
  // AC-1: Platform Admin picks the destination tenant and uploads a .xlsx file (HU-50 format).
  // AC-3: imported professionals have no PIN set and no system access enabled.
  // AC-4: a professional imported without the "activo" column defaults to active.
  // AC-5: a row with only nombre_completo filled in is valid (every other column is optional).
  test("AC1+AC3+AC4+AC5: Platform Admin imports valid rows into the chosen tenant, no PIN/system access, active by default, blank optional fields allowed", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tenant = await createTenant(
      request,
      platformToken,
      `E2E Import Profesionales Basico ${Date.now()}`,
    );

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/import");
    await page.getByTestId("import-tab-professionals").click();

    await page.locator("#import-run-tenant-professionals").selectOption({ value: String(tenant.id) });
    await page.locator("#import-run-file-professionals").setInputFiles(BASICO_XLSX);
    await page.getByRole("button", { name: "Import" }).click();

    const summary = page.getByTestId("import-run-summary-professionals");
    await expect(summary).toBeVisible({ timeout: 15_000 });
    await expect(summary).toContainText("2 of 2 rows imported. 0 failed.");

    const forged = forgeTenantAdminToken(tenant.id, "999991", "e2e-import-profesionales-basico@e2e.test");
    const profRes = await request.get(`${apiBaseUrl()}/api/professionals`, {
      headers: authHeaders(forged),
    });
    expect(profRes.ok(), await profRes.text()).toBeTruthy();
    const professionals = (await profRes.json()) as Array<{
      fullName: string;
      phone: string | null;
      email: string | null;
      active: boolean;
      hasPinSet: boolean;
      systemAccessAllowed: boolean;
      hasUserAccount: boolean;
    }>;
    expect(professionals).toHaveLength(2);

    const ana = professionals.find((p) => p.fullName === "ANA BENITEZ");
    expect(ana).toBeTruthy();
    expect(ana?.phone ?? null).toBeNull();
    expect(ana?.email ?? null).toBeNull();
    expect(ana?.active).toBe(true);
    expect(ana?.hasPinSet).toBe(false);
    expect(ana?.systemAccessAllowed).toBe(false);
    expect(ana?.hasUserAccount).toBe(false);

    const carlos = professionals.find((p) => p.fullName === "CARLOS DUARTE");
    expect(carlos).toBeTruthy();
    expect(carlos?.phone).toBe("0981123456");
    expect(carlos?.email).toBe("carlos.duarte@example.com");
    expect(carlos?.active).toBe(true);
    expect(carlos?.hasPinSet).toBe(false);
    expect(carlos?.systemAccessAllowed).toBe(false);
    expect(carlos?.hasUserAccount).toBe(false);
  });

  // AC-2: a row without nombre_completo is rejected without stopping the rest of the file.
  // AC-4: an explicit "NO" in the "activo" column creates an inactive professional.
  // AC-6: an incomplete phone number, an invalid email format, and a duplicate email (within the
  // same file) are rejected row by row, reusing the same rules as manual professional creation.
  test("AC2+AC4+AC6: blank name, invalid phone, invalid email, and duplicate email are rejected individually, valid rows still import", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tenant = await createTenant(
      request,
      platformToken,
      `E2E Import Profesionales Mixto ${Date.now()}`,
    );

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/import");
    await page.getByTestId("import-tab-professionals").click();

    await page.locator("#import-run-tenant-professionals").selectOption({ value: String(tenant.id) });
    await page.locator("#import-run-file-professionals").setInputFiles(MIXTO_XLSX);
    await page.getByRole("button", { name: "Import" }).click();

    const summary = page.getByTestId("import-run-summary-professionals");
    await expect(summary).toBeVisible({ timeout: 15_000 });
    await expect(summary).toContainText("3 of 7 rows imported. 4 failed.");

    const failedList = page.getByTestId("import-run-failed-rows-professionals");
    await expect(failedList).toContainText("Missing professional name.");
    await expect(failedList).toContainText(
      "Invalid phone number. Use a complete Paraguay number (e.g. 0981123456).",
    );
    await expect(failedList).toContainText("Invalid email address.");
    await expect(failedList).toContainText(
      "Another professional of this tenant already has this email address.",
    );

    const forged = forgeTenantAdminToken(tenant.id, "999990", "e2e-import-profesionales-mixto@e2e.test");
    const profRes = await request.get(`${apiBaseUrl()}/api/professionals`, {
      headers: authHeaders(forged),
    });
    expect(profRes.ok(), await profRes.text()).toBeTruthy();
    const professionals = (await profRes.json()) as Array<{ fullName: string; active: boolean }>;
    expect(professionals.map((p) => p.fullName).sort()).toEqual(
      [
        "PROFESIONAL EMAIL UNO",
        "PROFESIONAL VALIDO UNO",
        "PROFESIONAL VALIDO DOS",
      ].sort(),
    );
    const dos = professionals.find((p) => p.fullName === "PROFESIONAL VALIDO DOS");
    expect(dos?.active).toBe(false);
  });

  // AC-7 (isolation): the same email imported into two different tenants is accepted for both —
  // uniqueness is per-tenant, not global.
  test("AC7: identical email imported into two different tenants is accepted for both (isolation)", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tenantA = await createTenant(
      request,
      platformToken,
      `E2E Import Profesionales Aislamiento A ${Date.now()}`,
    );
    const tenantB = await createTenant(
      request,
      platformToken,
      `E2E Import Profesionales Aislamiento B ${Date.now()}`,
    );

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/import");
    await page.getByTestId("import-tab-professionals").click();

    for (const tenant of [tenantA, tenantB]) {
      await page.locator("#import-run-tenant-professionals").selectOption({ value: String(tenant.id) });
      await page.locator("#import-run-file-professionals").setInputFiles(AISLAMIENTO_XLSX);
      await page.getByRole("button", { name: "Import" }).click();

      const summary = page.getByTestId("import-run-summary-professionals");
      await expect(summary).toBeVisible({ timeout: 15_000 });
      await expect(summary).toContainText("1 of 1 rows imported. 0 failed.");
    }

    const forgedA = forgeTenantAdminToken(
      tenantA.id,
      "999989",
      "e2e-import-profesionales-aislamiento-a@e2e.test",
    );
    const forgedB = forgeTenantAdminToken(
      tenantB.id,
      "999988",
      "e2e-import-profesionales-aislamiento-b@e2e.test",
    );

    const profARes = await request.get(`${apiBaseUrl()}/api/professionals`, {
      headers: authHeaders(forgedA),
    });
    const profBRes = await request.get(`${apiBaseUrl()}/api/professionals`, {
      headers: authHeaders(forgedB),
    });
    expect(profARes.ok(), await profARes.text()).toBeTruthy();
    expect(profBRes.ok(), await profBRes.text()).toBeTruthy();

    const profA = (await profARes.json()) as Array<{ fullName: string; email: string | null }>;
    const profB = (await profBRes.json()) as Array<{ fullName: string; email: string | null }>;
    expect(profA).toHaveLength(1);
    expect(profB).toHaveLength(1);
    expect(profA[0].fullName).toBe("PROFESIONAL COMPARTIDO");
    expect(profB[0].fullName).toBe("PROFESIONAL COMPARTIDO");
    expect(profA[0].email).toBe("compartido@example.com");
    expect(profB[0].email).toBe("compartido@example.com");
  });
});
