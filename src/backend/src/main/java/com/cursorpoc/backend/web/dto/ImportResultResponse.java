package com.cursorpoc.backend.web.dto;

import java.util.List;

/**
 * HU-51: outcome of an actual import run. {@code fileAccepted=false} means the whole file was
 * rejected before any row was processed (bad extension, corrupt file, or a missing required column
 * — HU-50 AC-5/AC-6), in which case {@code errorCode} and/or {@code missingRequiredColumns} explain
 * why and the row counters are all 0. When {@code fileAccepted=true}, {@code rows} carries one
 * entry per processed data row (HU-54 will later add a persisted, richer report UI reusing this
 * same shape — this response already carries everything that needs).
 */
public record ImportResultResponse(
    boolean fileAccepted,
    String errorCode,
    List<String> missingRequiredColumns,
    int totalRows,
    int importedCount,
    int failedCount,
    List<ImportRowResultResponse> rows) {}
