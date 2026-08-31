package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.web.dto.InvoiceListItemResponse;
import java.io.ByteArrayInputStream;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.Test;

/** Issue #174 AC-05: the invoice-history report renders header data only, in PDF and .xlsx. */
class InvoiceHistoryReportServiceTest {

  private final InvoiceHistoryReportService service =
      new InvoiceHistoryReportService(new FemmeTimeProperties());

  private static final List<InvoiceListItemResponse> ROWS =
      List.of(
          new InvoiceListItemResponse(
              1L,
              7,
              "0000007",
              "ANA GARCIA",
              "ISSUED",
              new BigDecimal("150000.00"),
              Instant.parse("2026-08-20T13:00:00Z"),
              "Corte, Color",
              "CASH",
              "APPROVED"),
          new InvoiceListItemResponse(
              2L,
              8,
              "0000008",
              "CONSUMIDOR FINAL",
              "VOIDED",
              new BigDecimal("50000.00"),
              Instant.parse("2026-08-21T09:30:00Z"),
              "Manicura",
              "TRANSFER",
              null));

  @Test
  void renderPdf_producesANonEmptyPdf() {
    byte[] pdf = service.renderPdf(ROWS, Instant.parse("2026-08-01T00:00:00Z"), Instant.now());
    assertThat(pdf).isNotEmpty();
    assertThat(new String(pdf, 0, 4)).isEqualTo("%PDF");
  }

  @Test
  void renderXlsx_hasHeaderRowAndOneDataRowPerInvoice_headerDataOnly() throws Exception {
    byte[] xlsx = service.renderXlsx(ROWS, Instant.parse("2026-08-01T00:00:00Z"), Instant.now());
    assertThat(xlsx).isNotEmpty();

    try (XSSFWorkbook wb = new XSSFWorkbook(new ByteArrayInputStream(xlsx))) {
      Sheet sheet = wb.getSheetAt(0);
      Row header = sheet.getRow(2);
      assertThat(header.getCell(0).getStringCellValue()).isEqualTo("Número");
      assertThat(header.getCell(5).getStringCellValue()).isEqualTo("Total");

      Row first = sheet.getRow(3);
      assertThat(first.getCell(0).getStringCellValue()).isEqualTo("0000007");
      assertThat(first.getCell(2).getStringCellValue()).isEqualTo("ANA GARCIA");
      assertThat(first.getCell(3).getStringCellValue()).isEqualTo("Emitida");
      assertThat(first.getCell(4).getStringCellValue()).isEqualTo("Aprobado");
      assertThat(first.getCell(5).getNumericCellValue()).isEqualTo(150000d);

      Row second = sheet.getRow(4);
      assertThat(second.getCell(3).getStringCellValue()).isEqualTo("Anulada");
      assertThat(second.getCell(4).getStringCellValue()).isEqualTo("-");
      // The line-item detail ("Manicura") must never appear in the report.
      assertThat(second.getCell(0).getStringCellValue()).isEqualTo("0000008");
    }
  }
}
