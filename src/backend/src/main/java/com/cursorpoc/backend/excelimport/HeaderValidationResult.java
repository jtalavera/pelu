package com.cursorpoc.backend.excelimport;

import java.util.List;

/**
 * HU-50 AC-5/AC-6: outcome of validating a candidate file's row-1 headers against the standard
 * template, before any data row would be processed. {@code errorCode} is {@code
 * SCREAMING_SNAKE_CASE} (translated on the frontend via {@code femme.apiErrors.*}) and is set only
 * for whole-file problems (wrong extension, unreadable/corrupt file); a missing-required-column
 * rejection is reported instead through {@code missingRequiredColumns} so the Platform Admin sees
 * exactly which columns to add.
 */
public record HeaderValidationResult(
    boolean valid, String errorCode, List<String> missingRequiredColumns) {

  public static HeaderValidationResult ok() {
    return new HeaderValidationResult(true, null, List.of());
  }

  public static HeaderValidationResult fileError(String errorCode) {
    return new HeaderValidationResult(false, errorCode, List.of());
  }

  public static HeaderValidationResult missingColumns(List<String> missing) {
    return new HeaderValidationResult(false, null, missing);
  }
}
