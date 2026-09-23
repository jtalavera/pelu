package com.cursorpoc.backend.excelimport;

import java.util.List;

/**
 * HU-51 (Épica E — Importación de datos vía Excel): outcome of an actual upload → parse → persist
 * import run for one tenant/entity, as opposed to {@link HeaderValidationResult} which only checks
 * row 1. {@code fileAccepted=false} means the whole file was rejected before any row was processed
 * (bad extension, corrupt file, or a missing required column — HU-50 AC-5/AC-6); in that case
 * {@code totalRows}/{@code importedCount}/{@code failedCount} are 0 and {@code rows} is empty. Per
 * the PRD ("Importación... es transaccional por archivo: si una fila falla, las filas válidas igual
 * se importan"), once the file itself is accepted, every row is processed independently — a
 * rejected row never stops the rest of the file from importing.
 */
public record ImportResult(
    boolean fileAccepted,
    String errorCode,
    List<String> missingRequiredColumns,
    int totalRows,
    int importedCount,
    int failedCount,
    List<ImportRowOutcome> rows) {

  public static ImportResult fileError(String errorCode) {
    return new ImportResult(false, errorCode, List.of(), 0, 0, 0, List.of());
  }

  public static ImportResult missingColumns(List<String> missing) {
    return new ImportResult(false, null, missing, 0, 0, 0, List.of());
  }

  public static ImportResult completed(List<ImportRowOutcome> rows) {
    int imported = (int) rows.stream().filter(ImportRowOutcome::imported).count();
    int failed = rows.size() - imported;
    return new ImportResult(true, null, List.of(), rows.size(), imported, failed, rows);
  }
}
