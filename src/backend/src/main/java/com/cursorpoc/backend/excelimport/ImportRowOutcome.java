package com.cursorpoc.backend.excelimport;

/**
 * HU-51 AC-3/AC-4/AC-5: outcome of processing one data row of an import file. {@code rowNumber} is
 * the 1-based Excel row number (row 1 is the header, so the first data row is 2) so the Platform
 * Admin can find it in the spreadsheet. {@code errorCode} is {@code SCREAMING_SNAKE_CASE}
 * (translated via {@code femme.apiErrors.*}) and set only when {@code imported} is {@code false};
 * {@code name} is the row's entity name (when readable) so a short result list can be shown without
 * re-opening the file.
 */
public record ImportRowOutcome(int rowNumber, boolean imported, String errorCode, String name) {

  public static ImportRowOutcome imported(int rowNumber, String name) {
    return new ImportRowOutcome(rowNumber, true, null, name);
  }

  public static ImportRowOutcome rejected(int rowNumber, String errorCode, String name) {
    return new ImportRowOutcome(rowNumber, false, errorCode, name);
  }
}
