import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { loginAsPlatformAdmin } from "../fixtures/auth";

// HU-50 · Formato estándar de planillas Excel (servicios, clientes, profesionales)
// requirements/multi-tenant/HU-50-formato-estandar-de-planillas-excel.md
//
// Scope note: HU-50 is the documented column-template contract + a headers-only file check
// (AC-5/AC-6). It deliberately does NOT parse data rows or create any record (HU-51/52/53) — only
// the standard-columns documentation and a way to verify a candidate file's headers. The
// downloadable example spreadsheet with sample data rows is HU-55's separate scope, covered by
// hu-55-descargar-planillas-de-ejemplo.spec.ts.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VALID_HEADERS_XLSX = path.join(__dirname, "../fixtures/import/servicios-headers-validos.xlsx");
const MISSING_REQUIRED_XLSX = path.join(
  __dirname,
  "../fixtures/import/servicios-headers-incompletos.xlsx",
);

test.describe("HU-50 · Formato estándar de planillas Excel", () => {
  // AC-1 + AC-7: three distinct templates exist (servicios, clientes, profesionales), one per
  // tab, reachable from the platform nav at the moment the Platform Admin would import data —
  // not documented only in the HU-50 spec file.
  test("AC1+AC7: the import screen is reachable from the platform nav and shows one tab per importable entity", async ({
    page,
  }) => {
    await loginAsPlatformAdmin(page);
    await page.getByRole("link", { name: "Data import" }).click();
    await expect(page).toHaveURL(/\/platform\/import/);
    await expect(page.getByRole("heading", { name: "Data import" })).toBeVisible();

    await expect(page.getByTestId("import-tab-services")).toBeVisible();
    await expect(page.getByTestId("import-tab-clients")).toBeVisible();
    await expect(page.getByTestId("import-tab-professionals")).toBeVisible();
  });

  // AC-2: Servicios' exact fixed column set, with the documented required/optional split.
  test("AC2: Servicios template documents exactly categoria, nombre, precio, duracion_minutos, impuesto, activo", async ({
    page,
  }) => {
    await loginAsPlatformAdmin(page);
    await page.goto("/platform/import");
    await page.getByTestId("import-tab-services").click();

    const table = page.getByTestId("import-template-table-services");
    await expect(table).toBeVisible();

    const required = ["categoria", "nombre", "precio", "duracion_minutos"];
    const optional = ["impuesto", "activo"];
    for (const key of required) {
      const row = page.getByTestId(`import-column-row-services-${key}`);
      await expect(row).toBeVisible();
      await expect(row).toContainText("Required");
    }
    for (const key of optional) {
      const row = page.getByTestId(`import-column-row-services-${key}`);
      await expect(row).toBeVisible();
      await expect(row).toContainText("Optional");
    }
    // No column beyond the six documented above.
    await expect(table.locator("tbody tr")).toHaveCount(6);
  });

  // AC-3: Clientes' exact fixed column set — only nombre_completo is required.
  test("AC3: Clientes template documents exactly nombre_completo (required) plus 6 optional columns", async ({
    page,
  }) => {
    await loginAsPlatformAdmin(page);
    await page.goto("/platform/import");
    await page.getByTestId("import-tab-clients").click();

    const table = page.getByTestId("import-template-table-clients");
    await expect(table).toBeVisible();
    await expect(page.getByTestId("import-column-row-clients-nombre_completo")).toContainText(
      "Required",
    );
    for (const key of ["telefono", "email", "ruc", "documento_identidad", "direccion", "activo"]) {
      await expect(page.getByTestId(`import-column-row-clients-${key}`)).toContainText("Optional");
    }
    await expect(table.locator("tbody tr")).toHaveCount(7);
  });

  // AC-4: Profesionales' exact fixed column set — no PIN/system-access column exists (HU-22
  // configures those manually, never via Excel).
  test("AC4: Profesionales template documents exactly nombre_completo (required) plus 4 optional columns, no PIN/system-access column", async ({
    page,
  }) => {
    await loginAsPlatformAdmin(page);
    await page.goto("/platform/import");
    await page.getByTestId("import-tab-professionals").click();

    const table = page.getByTestId("import-template-table-professionals");
    await expect(table).toBeVisible();
    await expect(
      page.getByTestId("import-column-row-professionals-nombre_completo"),
    ).toContainText("Required");
    for (const key of ["telefono", "email", "direccion", "activo"]) {
      await expect(page.getByTestId(`import-column-row-professionals-${key}`)).toContainText(
        "Optional",
      );
    }
    await expect(table.locator("tbody tr")).toHaveCount(5);
    await expect(table).not.toContainText("pin");
  });

  // AC-5: headers with different casing and extra leading/trailing spaces are still accepted.
  test("AC5: a file whose header row differs only in casing/whitespace is accepted", async ({
    page,
  }) => {
    await loginAsPlatformAdmin(page);
    await page.goto("/platform/import");
    await page.getByTestId("import-tab-services").click();

    await page.locator("#import-file-services").setInputFiles(VALID_HEADERS_XLSX);
    await page.getByRole("button", { name: "Check headers" }).click();

    await expect(page.getByTestId("import-check-valid-services")).toBeVisible();
    await expect(page.getByTestId("import-check-valid-services")).toContainText(
      "valid for the Services template",
    );
  });

  // AC-5: a missing required column rejects the whole file before any row would be processed,
  // and reports exactly which column is missing.
  test("AC5: a file missing a required column is rejected and the missing column is named", async ({
    page,
  }) => {
    await loginAsPlatformAdmin(page);
    await page.goto("/platform/import");
    await page.getByTestId("import-tab-services").click();

    await page.locator("#import-file-services").setInputFiles(MISSING_REQUIRED_XLSX);
    await page.getByRole("button", { name: "Check headers" }).click();

    const result = page.getByTestId("import-check-invalid-services");
    await expect(result).toBeVisible();
    await expect(result).toContainText("Missing required columns");
    await expect(result).toContainText("precio");
  });

  // AC-6: only .xlsx files are accepted — a different extension is rejected with a clear message.
  test("AC6: a file with a non-.xlsx extension is rejected with a clear message", async ({
    page,
  }) => {
    await loginAsPlatformAdmin(page);
    await page.goto("/platform/import");
    await page.getByTestId("import-tab-clients").click();

    const csvFile = {
      name: "clientes.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("nombre_completo\nJuan Perez\n"),
    };
    await page.locator("#import-file-clients").setInputFiles(csvFile);
    await page.getByRole("button", { name: "Check headers" }).click();

    const result = page.getByTestId("import-check-invalid-clients");
    await expect(result).toBeVisible();
    await expect(result).toContainText("Only .xlsx files are accepted");
  });

  // AC-6: a corrupt/unreadable .xlsx file is rejected with a clear message, not a crash.
  test("AC6: a corrupt .xlsx file is rejected with a clear message", async ({ page }) => {
    await loginAsPlatformAdmin(page);
    await page.goto("/platform/import");
    await page.getByTestId("import-tab-professionals").click();

    const corruptFile = {
      name: "profesionales.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from("this is not a real xlsx workbook"),
    };
    await page.locator("#import-file-professionals").setInputFiles(corruptFile);
    await page.getByRole("button", { name: "Check headers" }).click();

    const result = page.getByTestId("import-check-invalid-professionals");
    await expect(result).toBeVisible();
    await expect(result).toContainText("could not be read");
  });

  // AC-7: the format is documented in a visible place at import time — human-readable descriptions
  // accompany each column, not just its key.
  test("AC7: each documented column shows a human-readable description, not only its key", async ({
    page,
  }) => {
    await loginAsPlatformAdmin(page);
    await page.goto("/platform/import");
    await page.getByTestId("import-tab-services").click();

    await expect(page.getByTestId("import-column-row-services-precio")).toContainText(
      "Guaraníes",
    );
    await expect(page.getByTestId("import-column-row-services-activo")).toContainText("SI or NO");
  });
});
