import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { apiBaseUrl, authHeaders, loginPlatformAdminApi } from "../fixtures/api";
import { loginAsPlatformAdmin } from "../fixtures/auth";

// Importación de datos — ajustes:
// 1) Every template table (Servicios, Productos, Profesionales, Clientes) on "/platform/import"
//    has a "Validations" column next to "Description" explaining the per-row rules the import
//    applies to each field.
// 2) The "precio greater than zero" rule is removed for Servicios and Productos: a 0 price is
//    imported; a negative one is still rejected.

const E2E_JWT_SECRET = "e2e-jwt-secret-min-32-characters-long!!";

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function forgeTenantAdminToken(tenantId: number, sub: string, email: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = { sub, email, role: "ADMIN", tid: tenantId, iat: now, exp: now + 3600 };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = createHmac("sha256", E2E_JWT_SECRET).update(signingInput).digest();
  return `${signingInput}.${base64url(signature)}`;
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

async function xlsx(rows: Array<Array<string | number>>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Datos");
  for (const row of rows) ws.addRow(row);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// One distinctive fragment of the documented rule per column, per entity.
const EXPECTED_VALIDATIONS: Record<string, Record<string, string>> = {
  services: {
    categoria: "already exists in the tenant as a product category",
    nombre: "Must not repeat another row of the file with the same categoria",
    precio: "Cannot be negative; 0 is allowed.",
    duracion_minutos: "whole number of at least 1",
    impuesto: "must match the name of a tax that already exists in the tenant",
    activo: "only NO creates the record as inactive",
  },
  products: {
    categoria: "already exists in the tenant as a service category",
    nombre: "Must not repeat another row of the file with the same categoria",
    precio: "Cannot be negative; 0 is allowed.",
    impuesto: "must match the name of a tax that already exists in the tenant",
    activo: "only NO creates the record as inactive",
    sku: "up to 64 characters",
  },
  professionals: {
    nombre_completo: "Cannot be empty.",
    telefono: "it must have 10 digits",
    email: "must be a valid email",
    direccion: "No validation.",
    activo: "only NO creates the record as inactive",
  },
  clients: {
    nombre_completo: "Cannot be empty.",
    telefono: "must not match (comparing digits only)",
    email: "Several clients may share the same email.",
    ruc: "80000005-6",
    documento_identidad: "No validation.",
    direccion: "No validation.",
    activo: "only NO creates the record as inactive",
  },
};

test.describe("Importación de datos — columna Validaciones y precio cero", () => {
  for (const [entity, columns] of Object.entries(EXPECTED_VALIDATIONS)) {
    test(`Ajuste 1: la tabla de ${entity} muestra la columna Validations al lado de Description con la regla de cada campo`, async ({
      page,
    }) => {
      await loginAsPlatformAdmin(page);
      await page.goto("/platform/import");
      await page.getByTestId(`import-tab-${entity}`).click();

      const table = page.getByTestId(`import-template-table-${entity}`);
      await expect(table).toBeVisible();
      const headers = table.locator("thead th");
      await expect(headers).toHaveText(["Column", "Requirement", "Description", "Validations"]);

      await expect(table.locator("tbody tr")).toHaveCount(Object.keys(columns).length);
      for (const [key, fragment] of Object.entries(columns)) {
        const cell = page.getByTestId(`import-column-validations-${entity}-${key}`);
        await expect(cell).toContainText(fragment);
        // The validations cell is the last one of its row, right after the description.
        await expect(page.getByTestId(`import-column-row-${entity}-${key}`).locator("td").nth(3)).toContainText(
          fragment,
        );
      }
    });
  }

  test("Ajuste 2: un servicio con precio 0 se importa; uno con precio negativo se rechaza", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tenant = await createTenant(request, platformToken, `E2E Import Precio Cero Svc ${Date.now()}`);
    const forged = forgeTenantAdminToken(tenant.id, "999989", "e2e-import-precio-cero-svc@e2e.test");

    const buffer = await xlsx([
      ["categoria", "nombre", "precio", "duracion_minutos", "impuesto", "activo"],
      ["Cortesias", "Lavado de cortesia", 0, 15, "", ""],
      ["Cortesias", "Precio negativo", -100, 15, "", ""],
    ]);

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/import");
    await page.getByTestId("import-tab-services").click();
    await page.locator("#import-run-tenant-services").selectOption({ value: String(tenant.id) });
    await page
      .locator("#import-run-file-services")
      .setInputFiles({ name: "servicios-precio-cero.xlsx", mimeType: XLSX_MIME, buffer });
    await page.getByRole("button", { name: "Import" }).click();

    await expect(page.getByTestId("import-run-summary-services")).toContainText("1 of 2 rows imported. 1 failed.", {
      timeout: 15_000,
    });
    await expect(page.getByTestId("import-run-failed-rows-services")).toContainText("Price cannot be negative");

    const svcRes = await request.get(`${apiBaseUrl()}/api/services`, { headers: authHeaders(forged) });
    expect(svcRes.ok(), await svcRes.text()).toBeTruthy();
    const services = (await svcRes.json()) as Array<{ name: string; kind: string; priceMinor: number }>;
    expect(services).toHaveLength(1);
    expect(services[0]).toMatchObject({ name: "Lavado de cortesia", kind: "SERVICE" });
    expect(Number(services[0].priceMinor)).toBe(0);
  });

  test("Ajuste 2: un producto con precio 0 se importa; uno con precio negativo se rechaza", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tenant = await createTenant(request, platformToken, `E2E Import Precio Cero Prod ${Date.now()}`);
    const forged = forgeTenantAdminToken(tenant.id, "999988", "e2e-import-precio-cero-prod@e2e.test");

    const buffer = await xlsx([
      ["categoria", "nombre", "precio", "impuesto", "activo", "sku"],
      ["Muestras", "Muestra gratis", 0, "", "", ""],
      ["Muestras", "Precio negativo", -1, "", "", ""],
    ]);

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/import");
    await page.getByTestId("import-tab-products").click();
    await page.locator("#import-run-tenant-products").selectOption({ value: String(tenant.id) });
    await page
      .locator("#import-run-file-products")
      .setInputFiles({ name: "productos-precio-cero.xlsx", mimeType: XLSX_MIME, buffer });
    await page.getByRole("button", { name: "Import" }).click();

    await expect(page.getByTestId("import-run-summary-products")).toContainText("1 of 2 rows imported. 1 failed.", {
      timeout: 15_000,
    });
    await expect(page.getByTestId("import-run-failed-rows-products")).toContainText("Price cannot be negative");

    const svcRes = await request.get(`${apiBaseUrl()}/api/services`, { headers: authHeaders(forged) });
    expect(svcRes.ok(), await svcRes.text()).toBeTruthy();
    const items = (await svcRes.json()) as Array<{ name: string; kind: string; priceMinor: number }>;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: "Muestra gratis", kind: "PRODUCT" });
    expect(Number(items[0].priceMinor)).toBe(0);
  });
});
