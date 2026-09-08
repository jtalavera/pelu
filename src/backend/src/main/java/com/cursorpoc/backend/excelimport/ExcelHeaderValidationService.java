package com.cursorpoc.backend.excelimport;

import java.io.ByteArrayInputStream;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import org.apache.poi.ss.usermodel.DataFormatter;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * HU-50 AC-5/AC-6: validates a candidate import file's structure — file extension, readability, and
 * whether row 1 carries every required column of the standard template for the given entity —
 * before any data row would be processed. Deliberately stops here: parsing data rows into
 * entities/records is HU-51 (services), HU-52 (clientes), HU-53 (profesionales), not this story.
 */
@Service
public class ExcelHeaderValidationService {

  private static final Logger log = LoggerFactory.getLogger(ExcelHeaderValidationService.class);

  private final ImportColumnTemplateRegistry templateRegistry;

  public ExcelHeaderValidationService(ImportColumnTemplateRegistry templateRegistry) {
    this.templateRegistry = templateRegistry;
  }

  /**
   * AC-6: only `.xlsx` is accepted; anything else (or no extension at all) is rejected without even
   * attempting to read the file.
   */
  public boolean hasValidExtension(String fileName) {
    if (fileName == null) {
      return false;
    }
    return fileName.toLowerCase(Locale.ROOT).endsWith(".xlsx");
  }

  /**
   * AC-5: the header row must contain every required column (case-insensitive, trimmed); AC-6: a
   * corrupt or unreadable file is rejected with a clear reason. Assumes {@link
   * #hasValidExtension(String)} was already checked by the caller — this method focuses on content,
   * not the file name.
   */
  public HeaderValidationResult validateHeaders(byte[] fileBytes, ImportEntityType entityType) {
    List<ImportColumnDefinition> columns = templateRegistry.columnsFor(entityType);
    Set<String> headerKeys = new HashSet<>();
    try (XSSFWorkbook workbook = new XSSFWorkbook(new ByteArrayInputStream(fileBytes))) {
      Sheet sheet = workbook.getSheetAt(0);
      Row headerRow = sheet != null ? sheet.getRow(sheet.getFirstRowNum()) : null;
      if (headerRow != null) {
        DataFormatter formatter = new DataFormatter();
        for (org.apache.poi.ss.usermodel.Cell cell : headerRow) {
          String raw = formatter.formatCellValue(cell);
          if (raw != null && !raw.isBlank()) {
            headerKeys.add(normalize(raw));
          }
        }
      }
    } catch (Exception ex) {
      log.error("validateHeaders entity={} status=REJECTED error=CORRUPT_FILE", entityType, ex);
      return HeaderValidationResult.fileError("CORRUPT_FILE");
    }

    List<String> missing = new ArrayList<>();
    for (ImportColumnDefinition column : columns) {
      if (column.required() && !headerKeys.contains(normalize(column.key()))) {
        missing.add(column.key());
      }
    }
    if (!missing.isEmpty()) {
      return HeaderValidationResult.missingColumns(missing);
    }
    return HeaderValidationResult.ok();
  }

  private static String normalize(String value) {
    return value.trim().toLowerCase(Locale.ROOT);
  }
}
