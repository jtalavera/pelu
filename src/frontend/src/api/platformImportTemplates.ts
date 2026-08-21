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
