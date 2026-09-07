package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.enums.InvoiceStatus;
import com.cursorpoc.backend.domain.enums.SifenSubmissionStatus;
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

  private static final List<InvoiceReportRow> ROWS =
      List.of(
          new InvoiceReportRow(
              7,
              "ANA GARCIA",
              InvoiceStatus.ISSUED,
              new BigDecimal("150000.00"),
              Instant.parse("2026-08-20T13:00:00Z"),
              SifenSubmissionStatus.APPROVED),
          new InvoiceReportRow(
              8,
              "CONSUMIDOR FINAL",
              InvoiceStatus.VOIDED,
              new BigDecimal("50000.00"),
              Instant.parse("2026-08-21T09:30:00Z"),
              null));

  @Test
  void renderPdf_producesANonEmptyPdf() {
    byte[] pdf = service.renderPdf(ROWS, Instant.parse("2026-08-01T00:00:00Z"), Instant.now());
    assertThat(pdf).isNotEmpty();
    assertThat(new String(pdf, 0, 4)).isEqualTo("%PDF");
  }

  @Test
  void computeGrandTotal_excludesVoidedAndSifenRejected() {
    var rows =
        List.of(
            new InvoiceReportRow(
                1,
                "A",
                InvoiceStatus.ISSUED,
                new BigDecimal("100000"),
                Instant.now(),
                SifenSubmissionStatus.APPROVED),
            new InvoiceReportRow(
                2,
                "B",
                InvoiceStatus.ISSUED,
                new BigDecimal("70000"),
                Instant.now(),
                SifenSubmissionStatus.REJECTED),
            new InvoiceReportRow(
                3, "C", InvoiceStatus.VOIDED, new BigDecimal("50000"), Instant.now(), null),
            new InvoiceReportRow(
                4, "D", InvoiceStatus.ISSUED, new BigDecimal("30000"), Instant.now(), null));

    assertThat(InvoiceHistoryReportService.computeGrandTotal(rows))
        .isEqualByComparingTo(new BigDecimal("130000"));
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
