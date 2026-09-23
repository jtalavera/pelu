import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { loginAsPlatformAdmin } from "../fixtures/auth";

// HU-55 · Descargar planillas de ejemplo por entidad
// requirements/multi-tenant/HU-55-descargar-planillas-de-ejemplo.md
//
// Builds on HU-50's documented column templates (ImportColumnTemplateRegistry, the same single
// source of truth ExcelHeaderValidationService validates on upload) by letting the Platform Admin
// download a ready-to-fill example .xlsx per entity from the "/platform/import" screen — exact
// headers (AC-1/AC-3) plus 1-2 fictional sample data rows illustrating the format, including
// `activo` as SI/NO (AC-2). AC-4: the sample rows are plain data rows the Platform Admin can delete
// and reuse the same file for a real import.

const EXPECTED_COLUMNS: Record<string, { required: string[]; optional: string[] }> = {
  services: {
    required: ["categoria", "nombre", "precio", "duracion_minutos"],
    optional: ["impuesto", "activo"],
  },
  clients: {
    required: ["nombre_completo"],
    optional: ["telefono", "email", "ruc", "documento_identidad", "direccion", "activo"],
  },
  professionals: {
    required: ["nombre_completo"],
    optional: ["telefono", "email", "direccion", "activo"],
  },
};

async function downloadExampleWorkbook(
  page: import("@playwright/test").Page,
  entity: string,
): Promise<{ headerRow: string[]; dataRows: string[][]; suggestedFilename: string }> {
  await page.getByTestId(`import-tab-${entity}`).click();
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 20_000 }),
    page.getByTestId(`import-download-example-${entity}`).click(),
  ]);
  const filePath = await download.path();
  expect(filePath).not.toBeNull();

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath!);
  const sheet = workbook.worksheets[0];
  expect(sheet).toBeTruthy();

  const toStringRow = (rowNumber: number): string[] => {
    const row = sheet.getRow(rowNumber);
    const values: string[] = [];
    // exceljs Row.values is 1-indexed (index 0 is empty) — normalize to a plain 0-indexed array.
    for (let col = 1; col <= sheet.columnCount; col++) {
      const cell = row.getCell(col);
      values.push(cell.value == null ? "" : String(cell.value));
    }
    return values;
  };

  const headerRow = toStringRow(1);
  const dataRows: string[][] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = toStringRow(r);
    if (row.some((v) => v !== "")) {
      dataRows.push(row);
    }
  }

  return { headerRow, dataRows, suggestedFilename: download.suggestedFilename() };
}

test.describe("HU-55 · Descargar planillas de ejemplo por entidad", () => {
  // AC-1: from the import screen, a "Download example" button exists on each entity tab and
  // produces a real, non-empty .xlsx download — servicios, clientes and profesionales.
  for (const entity of ["services", "clients", "professionals"] as const) {
    test(`AC1: downloads a non-empty .xlsx example file for ${entity}`, async ({ page }) => {
      await loginAsPlatformAdmin(page);
      await page.goto("/platform/import");

      const { headerRow, suggestedFilename } = await downloadExampleWorkbook(page, entity);

      expect(suggestedFilename.toLowerCase()).toMatch(/\.xlsx$/);
      expect(headerRow.length).toBeGreaterThan(0);
    });
  }

  // AC-2: each template includes 1-2 fictional sample data rows, and the `activo` column (when
  // present) uses the SI/NO format the importer expects — never true/false or 1/0.
  test("AC2: each template includes 1-2 fictional sample rows with activo as SI/NO", async ({
    page,
  }) => {
    await loginAsPlatformAdmin(page);
    await page.goto("/platform/import");

    for (const entity of ["services", "clients", "professionals"] as const) {
      const { headerRow, dataRows } = await downloadExampleWorkbook(page, entity);

      expect(dataRows.length).toBeGreaterThanOrEqual(1);
      expect(dataRows.length).toBeLessThanOrEqual(2);

      const activoIndex = headerRow.findIndex((h) => h.trim().toLowerCase() === "activo");
      expect(activoIndex).toBeGreaterThanOrEqual(0);
      for (const row of dataRows) {
        const activoValue = row[activoIndex];
        expect(["SI", "NO"]).toContain(activoValue);
      }

      // Sample data is obviously fictional, not a real record — every row has some non-empty
      // required-column value so the row isn't blank.
      const requiredIndexes = EXPECTED_COLUMNS[entity].required.map((key) =>
        headerRow.findIndex((h) => h.trim().toLowerCase() === key),
      );
      for (const row of dataRows) {
        for (const idx of requiredIndexes) {
          expect(row[idx]?.trim()).not.toBe("");
        }
      }
    }
  });

  // AC-3: the downloaded headers are exactly the ones HU-50's importer requires — no divergence
  // between what is downloaded and what is validated on upload (checked via the same "Check
  // headers" flow HU-50 exposes).
  for (const entity of ["services", "clients", "professionals"] as const) {
    test(`AC3: ${entity} example headers match the documented template exactly`, async ({
      page,
    }) => {
      await loginAsPlatformAdmin(page);
      await page.goto("/platform/import");

      const { headerRow } = await downloadExampleWorkbook(page, entity);
      const normalizedHeaders = headerRow.map((h) => h.trim().toLowerCase()).filter((h) => h !== "");
      const expected = [...EXPECTED_COLUMNS[entity].required, ...EXPECTED_COLUMNS[entity].optional];

      expect(normalizedHeaders.sort()).toEqual([...expected].sort());
    });
  }

  // AC-3/AC-4: the downloaded file's headers are accepted as-is by the "Check headers" flow (same
  // template, no divergence), and remain accepted once the sample rows are deleted — proving the
  // Platform Admin can reuse the very same file for a real import.
  for (const entity of ["services", "clients", "professionals"] as const) {
    test(`AC3+AC4: ${entity} example file (with and without sample rows) passes the header check unchanged`, async ({
      page,
    }) => {
      await loginAsPlatformAdmin(page);
      await page.goto("/platform/import");
      await page.getByTestId(`import-tab-${entity}`).click();

      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 20_000 }),
        page.getByTestId(`import-download-example-${entity}`).click(),
      ]);
      const downloadedPath = await download.path();
      expect(downloadedPath).not.toBeNull();

      // Playwright saves downloads under a temp name with no extension — `setInputFiles` derives
      // the uploaded File's name from the path's basename, and the backend's extension check
      // (HU-50 AC-6) rejects anything not literally ending in ".xlsx", so copy it to a real
      // `<name>.xlsx` path first, exactly as a person re-uploading their saved download would have.
      const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "hu55-"));
      const filePath = path.join(workDir, `${entity}-example.xlsx`);
      await fs.copyFile(downloadedPath!, filePath);

      // Re-upload the downloaded file unchanged (still has its sample rows): headers must validate.
      await page.locator(`#import-file-${entity}`).setInputFiles(filePath);
      await page.getByRole("button", { name: "Check headers" }).click();
      await expect(page.getByTestId(`import-check-valid-${entity}`)).toBeVisible();

      // AC-4: delete the sample rows (keep only the header row) and confirm the same headers are
      // still accepted — the Platform Admin can reuse this exact file for a real import.
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);
      const sheet = workbook.worksheets[0];
      for (let r = sheet.rowCount; r >= 2; r--) {
        sheet.spliceRows(r, 1);
      }
      const strippedPath = path.join(workDir, `${entity}-example-headers-only.xlsx`);
      await workbook.xlsx.writeFile(strippedPath);

      await page.locator(`#import-file-${entity}`).setInputFiles(strippedPath);
      await page.getByRole("button", { name: "Check headers" }).click();
      await expect(page.getByTestId(`import-check-valid-${entity}`)).toBeVisible();
    });
  }
});
