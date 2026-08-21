package com.cursorpoc.backend.web.dto;

import java.time.Instant;
import java.util.List;

/**
 * HU-54 (Épica E — Importación de datos vía Excel) AC-4: the persisted last import attempt of one
 * entity for one tenant, so the Platform Admin can revisit it after leaving and returning — {@code
 * available=false} means no import has ever run for this tenant/entity pair yet, in which case
 * every other field is a placeholder default. Otherwise this carries the same shape as {@link
 * ImportResultResponse} plus who/when/which file, since that immediate response is not persisted.
 */
public record ImportReportResponse(
    boolean available,
    String fileName,
    Instant importedAt,
    String importedByEmail,
    boolean fileAccepted,
    String errorCode,
    List<String> missingRequiredColumns,
    int totalRows,
    int importedCount,
    int failedCount,
    List<ImportRowResultResponse> rows) {

  public static ImportReportResponse unavailable() {
    return new ImportReportResponse(
        false, null, null, null, false, null, List.of(), 0, 0, 0, List.of());
  }
}
