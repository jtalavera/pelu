package com.cursorpoc.backend.excelimport;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellStyle;
import org.apache.poi.ss.usermodel.Font;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.stereotype.Component;

/**
 * HU-55 (Épica E — Importación de datos vía Excel): builds a ready-to-fill example {@code .xlsx}
 * per entity — AC-1/AC-3: the exact header row from {@link ImportColumnTemplateRegistry}, the same
 * single source of truth {@link ExcelHeaderValidationService} validates on upload, so a downloaded
 * template can never drift from what the importer accepts. AC-2: 1-2 fictional sample data rows
 * illustrating the expected format, including {@code activo} as {@code SI}/{@code NO}. AC-4: the
 * sample rows are plain data rows (no locked cells, no extra sheets/markers) so the Platform Admin
 * can delete them and reuse the same file for a real import.
 */
@Component
public class ImportExampleFileGenerator {

  private final ImportColumnTemplateRegistry templateRegistry;

  public ImportExampleFileGenerator(ImportColumnTemplateRegistry templateRegistry) {
    this.templateRegistry = templateRegistry;
  }

  /** AC-1/AC-2/AC-3: header row (exact template columns) + fictional sample rows for the entity. */
  public byte[] generate(ImportEntityType entityType) {
    List<ImportColumnDefinition> columns = templateRegistry.columnsFor(entityType);
    List<Map<String, String>> sampleRows = sampleRowsFor(entityType);

    try (XSSFWorkbook workbook = new XSSFWorkbook()) {
      Sheet sheet = workbook.createSheet(entityType.pathSegment());

      CellStyle headerStyle = workbook.createCellStyle();
      Font headerFont = workbook.createFont();
      headerFont.setBold(true);
      headerStyle.setFont(headerFont);

      Row headerRow = sheet.createRow(0);
      for (int i = 0; i < columns.size(); i++) {
        Cell cell = headerRow.createCell(i);
        cell.setCellValue(columns.get(i).key());
        cell.setCellStyle(headerStyle);
      }

      int rowIndex = 1;
      for (Map<String, String> sampleRow : sampleRows) {
        Row row = sheet.createRow(rowIndex++);
        for (int i = 0; i < columns.size(); i++) {
          String value = sampleRow.get(columns.get(i).key());
          if (value != null && !value.isEmpty()) {
            row.createCell(i).setCellValue(value);
          }
        }
      }

      for (int i = 0; i < columns.size(); i++) {
        sheet.autoSizeColumn(i);
      }

      ByteArrayOutputStream out = new ByteArrayOutputStream();
      workbook.write(out);
      return out.toByteArray();
    } catch (IOException ex) {
      throw new UncheckedIOException("Failed to generate example import file", ex);
    }
  }

  /** Suggested download file name, distinct per entity so multiple downloads don't collide. */
  public String fileNameFor(ImportEntityType entityType) {
    return switch (entityType) {
      case SERVICES -> "plantilla_ejemplo_servicios.xlsx";
      case CLIENTS -> "plantilla_ejemplo_clientes.xlsx";
      case PROFESSIONALS -> "plantilla_ejemplo_profesionales.xlsx";
    };
  }

  /**
   * AC-2: fictional (obviously fake) sample data, 1-2 rows per entity, exercising both the required
   * columns and the optional ones (including a blank optional value on at least one row, to show it
   * truly is optional).
   */
  private static List<Map<String, String>> sampleRowsFor(ImportEntityType entityType) {
    return switch (entityType) {
      case SERVICES ->
          List.of(
              rowOf(
                  "categoria", "Cortes",
                  "nombre", "Corte de cabello",
                  "precio", "80000",
                  "duracion_minutos", "30",
                  "impuesto", "IVA 10%",
                  "activo", "SI"),
              rowOf(
                  "categoria", "Coloración",
                  "nombre", "Tinte completo",
                  "precio", "250000",
                  "duracion_minutos", "90",
                  "impuesto", "",
                  "activo", "SI"));
      case CLIENTS ->
          List.of(
              rowOf(
                  "nombre_completo", "María López (ejemplo)",
                  "telefono", "0981123456",
                  "email", "maria.lopez@example.com",
                  "ruc", "80000005-6",
                  "documento_identidad", "",
                  "direccion", "Av. España 123, Asunción",
                  "activo", "SI"),
              rowOf(
                  "nombre_completo", "Carlos Gómez (ejemplo)",
                  "telefono", "0982987654",
                  "email", "",
                  "ruc", "",
                  "documento_identidad", "3456789",
                  "direccion", "Mcal. López 456, Asunción",
                  "activo", "SI"));
      case PROFESSIONALS ->
          List.of(
              rowOf(
                  "nombre_completo", "Juan Pérez (ejemplo)",
                  "telefono", "0983111222",
                  "email", "juan.perez@example.com",
                  "direccion", "Av. Mariscal López 789, Asunción",
                  "activo", "SI"));
    };
  }

  private static Map<String, String> rowOf(String... keyValuePairs) {
    Map<String, String> map = new LinkedHashMap<>();
    for (int i = 0; i < keyValuePairs.length; i += 2) {
      map.put(keyValuePairs[i], keyValuePairs[i + 1]);
    }
    return map;
  }
}
