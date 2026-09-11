package com.cursorpoc.backend.excelimport;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.ByteArrayOutputStream;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.Test;

/**
 * HU-50 AC-5/AC-6: header row + file-format validation, standalone from any upload/import endpoint
 * (constructs .xlsx bytes in memory, no MultipartFile/HTTP involved).
 */
class ExcelHeaderValidationServiceTest {

  private final ImportColumnTemplateRegistry registry = new ImportColumnTemplateRegistry();
  private final ExcelHeaderValidationService service = new ExcelHeaderValidationService(registry);

  private static byte[] workbookWithHeaderRow(String... headers) {
    try (XSSFWorkbook workbook = new XSSFWorkbook();
        ByteArrayOutputStream out = new ByteArrayOutputStream()) {
      Sheet sheet = workbook.createSheet("Sheet1");
      Row row = sheet.createRow(0);
      for (int i = 0; i < headers.length; i++) {
        row.createCell(i).setCellValue(headers[i]);
      }
      workbook.write(out);
      return out.toByteArray();
    } catch (Exception e) {
      throw new RuntimeException(e);
    }
  }

  // AC-2: every required Servicios column present, exactly as documented, is accepted.
  @Test
  void servicesTemplate_allRequiredColumnsPresent_isValid() {
    byte[] bytes =
        workbookWithHeaderRow(
            "categoria", "nombre", "precio", "duracion_minutos", "impuesto", "activo");
    HeaderValidationResult result = service.validateHeaders(bytes, ImportEntityType.SERVICES);
    assertThat(result.valid()).isTrue();
    assertThat(result.missingRequiredColumns()).isEmpty();
    assertThat(result.errorCode()).isNull();
  }

  // AC-5: headers with extra surrounding whitespace and different casing are still accepted.
  @Test
  void headers_caseInsensitiveAndTrimmed_areAccepted() {
    byte[] bytes =
        workbookWithHeaderRow(
            "  CATEGORIA  ", " Nombre", "PRECIO ", "Duracion_Minutos", "impuesto", "ACTIVO");
    HeaderValidationResult result = service.validateHeaders(bytes, ImportEntityType.SERVICES);
    assertThat(result.valid()).isTrue();
  }

  // AC-5: a missing required column rejects the whole file (before any row would be processed),
  // reporting exactly which column(s) are missing.
  @Test
  void servicesTemplate_missingRequiredColumn_isRejectedWithMissingList() {
    // "precio" (required) is missing.
    byte[] bytes = workbookWithHeaderRow("categoria", "nombre", "duracion_minutos");
    HeaderValidationResult result = service.validateHeaders(bytes, ImportEntityType.SERVICES);
    assertThat(result.valid()).isFalse();
    assertThat(result.missingRequiredColumns()).containsExactly("precio");
  }

  // AC-3: optional Clientes columns can be entirely absent; only nombre_completo is required.
  @Test
  void clientsTemplate_onlyRequiredColumnPresent_isValid() {
    byte[] bytes = workbookWithHeaderRow("nombre_completo");
    HeaderValidationResult result = service.validateHeaders(bytes, ImportEntityType.CLIENTS);
    assertThat(result.valid()).isTrue();
  }

  // AC-4: Profesionales requires only nombre_completo; PIN/system access are never columns.
  @Test
  void professionalsTemplate_missingRequiredColumn_isRejected() {
    byte[] bytes = workbookWithHeaderRow("telefono", "email");
    HeaderValidationResult result = service.validateHeaders(bytes, ImportEntityType.PROFESSIONALS);
    assertThat(result.valid()).isFalse();
    assertThat(result.missingRequiredColumns()).containsExactly("nombre_completo");
  }

  // AC-6: a corrupt/unreadable file is rejected with a clear reason, not an unhandled exception.
  @Test
  void corruptFile_isRejectedWithClearErrorCode() {
    byte[] garbage = "this is not a real xlsx file".getBytes();
    HeaderValidationResult result = service.validateHeaders(garbage, ImportEntityType.SERVICES);
    assertThat(result.valid()).isFalse();
    assertThat(result.errorCode()).isEqualTo("CORRUPT_FILE");
  }

  // AC-6: only .xlsx is accepted as a file extension.
  @Test
  void extensionCheck_onlyXlsxIsAccepted() {
    assertThat(service.hasValidExtension("planilla.xlsx")).isTrue();
    assertThat(service.hasValidExtension("PLANILLA.XLSX")).isTrue();
    assertThat(service.hasValidExtension("planilla.xls")).isFalse();
    assertThat(service.hasValidExtension("planilla.csv")).isFalse();
    assertThat(service.hasValidExtension("planilla")).isFalse();
    assertThat(service.hasValidExtension(null)).isFalse();
  }
}
