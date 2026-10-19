import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { apiBaseUrl, authHeaders, loginPlatformAdminApi } from "../fixtures/api";
import { loginAsPlatformAdmin } from "../fixtures/auth";

// Importar productos desde Excel
// requirements/multi-tenant/importar-productos-desde-excel.md
//
// The Platform Admin's "/platform/import" screen gets a "Productos" tab next to "Servicios" (the
// catalog split gives products their own screen and categories). The products file has no
// duracion_minutos column: every row becomes a Producto (stored with the 1-minute minimum
// duration), in a product category auto-created when missing. No import syncs to Stock on its
// own (covered in stock/hu-62-sincronizar-catalogo.spec.ts).

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
  const ws = wb.addWorksheet("Productos");
  for (const row of rows) ws.addRow(row);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

test.describe("Importar productos desde Excel", () => {
  // AC-1: the import screen has a Productos tab documenting its own column set — no
  // duracion_minutos.
  test("AC1: la solapa Productos documenta categoria, nombre, precio (obligatorias) e impuesto, activo, sku (opcionales)", async ({
    page,
  }) => {
    await loginAsPlatformAdmin(page);
    await page.goto("/platform/import");
    await page.getByTestId("import-tab-products").click();

    const table = page.getByTestId("import-template-table-products");
    await expect(table).toBeVisible();
    for (const key of ["categoria", "nombre", "precio"]) {
      await expect(page.getByTestId(`import-column-row-products-${key}`)).toContainText("Required");
    }
    for (const key of ["impuesto", "activo", "sku"]) {
      await expect(page.getByTestId(`import-column-row-products-${key}`)).toContainText("Optional");
    }
    await expect(table.locator("tbody tr")).toHaveCount(6);
    await expect(page.getByTestId("import-column-row-products-nombre")).toContainText("Product name.");
  });

  // AC-2 + AC-3 + AC-5: valid rows become Productos (duration 1, SKU kept) in an auto-created
  // product category, scoped to the chosen tenant; a row pointing at an existing service
  // category is rejected with its own reason while the rest of the file still imports.
  test("AC2+AC3+AC5: importa productos en el tenant elegido, crea la categoría como de productos y rechaza filas en categorías de servicios", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tenant = await createTenant(request, platformToken, `E2E Import Productos ${Date.now()}`);
    const forged = forgeTenantAdminToken(tenant.id, "999995", "e2e-import-productos@e2e.test");

    const catRes = await request.post(`${apiBaseUrl()}/api/service-categories`, {
      headers: authHeaders(forged),
      data: { name: "Cortes", kind: "SERVICE" },
    });
    expect(catRes.ok(), await catRes.text()).toBeTruthy();

    const buffer = await xlsx([
      ["categoria", "nombre", "precio", "impuesto", "activo", "sku"],
      ["Cuidado capilar", "Shampoo 300 ml", 95000, "", "SI", "SH-300"],
      ["Cuidado capilar", "Acondicionador 300 ml", 85000, "", "NO", ""],
      ["Cortes", "Cera en categoria de servicios", 50000, "", "SI", ""],
    ]);

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/import");
    await page.getByTestId("import-tab-products").click();
    await page.locator("#import-run-tenant-products").selectOption({ value: String(tenant.id) });
    await page.locator("#import-run-file-products").setInputFiles({ name: "productos.xlsx", mimeType: XLSX_MIME, buffer });
    await page.getByRole("button", { name: "Import" }).click();

    await expect(page.getByTestId("import-run-summary-products")).toContainText("2 of 3 rows imported. 1 failed.", {
      timeout: 15_000,
    });
    await expect(page.getByTestId("import-run-failed-rows-products")).toContainText(
      "That category already exists as the other type",
    );

    const get = async <T>(url: string) =>
      (await (await request.get(`${apiBaseUrl()}${url}`, { headers: authHeaders(forged) })).json()) as T;
    const productCats = (await get<Array<{ name: string }>>("/api/service-categories?kind=PRODUCT")).map((c) => c.name);
    expect(productCats).toEqual(["Cuidado capilar"]);
    const serviceCats = (await get<Array<{ name: string }>>("/api/service-categories?kind=SERVICE")).map((c) => c.name);
    expect(serviceCats).toEqual(["Cortes"]);

    const items = await get<
      Array<{ name: string; kind: string; durationMinutes: number; sku: string | null; active: boolean }>
    >("/api/services");
    expect(items).toHaveLength(2);
    const shampoo = items.find((i) => i.name === "Shampoo 300 ml");
    expect(shampoo).toMatchObject({ kind: "PRODUCT", durationMinutes: 1, sku: "SH-300", active: true });
    const acondicionador = items.find((i) => i.name === "Acondicionador 300 ml");
    expect(acondicionador).toMatchObject({ kind: "PRODUCT", durationMinutes: 1, active: false });
  });

  // AC-4: a file missing a required column is rejected as a whole, listing what is missing.
  test("AC4: un archivo sin la columna precio se rechaza entero indicando la columna faltante", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tenant = await createTenant(request, platformToken, `E2E Import Productos Sin Precio ${Date.now()}`);
    const buffer = await xlsx([
      ["categoria", "nombre"],
      ["Cuidado capilar", "Shampoo"],
    ]);

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/import");
    await page.getByTestId("import-tab-products").click();
    await page.locator("#import-run-tenant-products").selectOption({ value: String(tenant.id) });
    await page.locator("#import-run-file-products").setInputFiles({ name: "sin-precio.xlsx", mimeType: XLSX_MIME, buffer });
    await page.getByRole("button", { name: "Import" }).click();

    await expect(page.getByTestId("import-run-rejected-products")).toContainText("precio", { timeout: 15_000 });
  });
});
