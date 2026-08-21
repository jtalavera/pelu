import { femmeJson, femmePostJson } from "./femmeClient";

/**
 * HU-50 (Épica E — Importación de datos vía Excel): the three standard import templates
 * (servicios/clientes/profesionales), documented for the Platform Admin at import time (AC-7).
 * `entity` is the literal path segment ("services" | "clients" | "professionals") returned by the
 * backend — used both as the React key/tab value and in the validate-headers request below.
 */
export type ImportColumn = {
  key: string;
  required: boolean;
};

export type ImportColumnTemplate = {
  entity: string;
  columns: ImportColumn[];
};

export function listImportTemplates(): Promise<ImportColumnTemplate[]> {
  return femmeJson<ImportColumnTemplate[]>("/api/platform/import-templates");
}

/**
 * HU-50 AC-5/AC-6: result of checking a candidate file's extension, readability, and header row —
 * never parses data rows or creates any record (that's HU-51/52/53). `errorCode` is set only for
 * whole-file problems (translated via `femme.apiErrors.*`); a missing-required-column rejection is
 * reported through `missingRequiredColumns` instead.
 */
export type HeaderValidationResult = {
  valid: boolean;
  errorCode: string | null;
  missingRequiredColumns: string[];
};

export function validateImportHeaders(
  entity: string,
  fileName: string,
  fileBase64: string,
): Promise<HeaderValidationResult> {
  return femmePostJson<HeaderValidationResult>(
    `/api/platform/import-templates/${encodeURIComponent(entity)}/validate-headers`,
    { fileName, fileBase64 },
  );
}

/**
 * HU-51 AC-3/AC-4/AC-5: outcome of one data row of an actual import run. `errorCode` (translated
 * via `femme.apiErrors.*`) is set only when `imported` is false.
 */
export type ImportRowResult = {
  rowNumber: number;
  imported: boolean;
  errorCode: string | null;
  name: string | null;
};

/**
 * HU-51: outcome of an actual upload -> parse -> persist import run. `fileAccepted=false` means
 * the whole file was rejected before any row was processed (HU-50 AC-5/AC-6) — `errorCode` and/or
 * `missingRequiredColumns` explain why, same shape as `HeaderValidationResult`. When
 * `fileAccepted=true`, `rows` has one entry per processed data row; the full formal per-row report
 * screen is HU-54's separate scope — this is only the immediate result of one import.
 */
export type ImportResult = {
  fileAccepted: boolean;
  errorCode: string | null;
  missingRequiredColumns: string[];
  totalRows: number;
  importedCount: number;
  failedCount: number;
  rows: ImportRowResult[];
};

/** HU-51 AC-1: Platform Admin uploads a file to actually import data into the target tenant. */
export function importEntityData(
  tenantId: number,
  entity: string,
  fileName: string,
  fileBase64: string,
): Promise<ImportResult> {
  return femmePostJson<ImportResult>(
    `/api/platform/tenants/${tenantId}/import/${encodeURIComponent(entity)}`,
    { fileName, fileBase64 },
  );
}
