package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.enums.InvoiceStatus;
import com.cursorpoc.backend.domain.enums.SifenSubmissionStatus;
import com.lowagie.text.Document;
import com.lowagie.text.DocumentException;
import com.lowagie.text.Element;
import com.lowagie.text.Font;
import com.lowagie.text.PageSize;
import com.lowagie.text.Paragraph;
import com.lowagie.text.Phrase;
import com.lowagie.text.pdf.BaseFont;
import com.lowagie.text.pdf.PdfPCell;
import com.lowagie.text.pdf.PdfPTable;
import com.lowagie.text.pdf.PdfWriter;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellStyle;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.stereotype.Service;

/**
 * Issue #174 AC-05: "Historial de comprobantes" report in Excel (.xlsx) and PDF. Only the emitted
 * invoice's header data — never the line detail — for every row currently shown by the History
 * filter.
 */
@Service
public class InvoiceHistoryReportService {

  private static final Locale ES_PY = Locale.forLanguageTag("es-PY");

  private final FemmeTimeProperties timeProperties;

  public InvoiceHistoryReportService(FemmeTimeProperties timeProperties) {
    this.timeProperties = timeProperties;
  }

  // ── PDF ────────────────────────────────────────────────────────────────────

  public byte[] renderPdf(List<InvoiceReportRow> rows, Instant from, Instant to) {
    ZoneId zone = timeProperties.zoneId();
    DateTimeFormatter dateTimeFmt =
        DateTimeFormatter.ofPattern("dd/MM/yyyy HH:mm").withZone(zone).withLocale(ES_PY);
    try {
      Document document = new Document(PageSize.A4.rotate(), 24, 24, 32, 32);
      ByteArrayOutputStream baos = new ByteArrayOutputStream();
      PdfWriter.getInstance(document, baos);
      document.open();

      BaseFont bf = BaseFont.createFont(BaseFont.HELVETICA, BaseFont.CP1252, BaseFont.NOT_EMBEDDED);
      BaseFont bfBold =
          BaseFont.createFont(BaseFont.HELVETICA_BOLD, BaseFont.CP1252, BaseFont.NOT_EMBEDDED);
      Font titleFont = new Font(bfBold, 14);
      Font headerFont = new Font(bfBold, 9);
      Font bodyFont = new Font(bf, 9);
      Font boldFont = new Font(bfBold, 9);

      document.add(new Paragraph("Historial de comprobantes", titleFont));
      document.add(new Paragraph(dateRangeLabel(from, to, zone), bodyFont));
      document.add(new Paragraph(" "));

      PdfPTable table = new PdfPTable(new float[] {1.4f, 2.2f, 3.2f, 1.6f, 2.2f, 2f});
      table.setWidthPercentage(100);
      for (String h :
          new String[] {
            "Número", "Fecha de emisión", "Cliente", "Estado", "Estado SIFEN", "Total"
          }) {
        addCell(table, h, headerFont, Element.ALIGN_LEFT);
      }

      for (InvoiceReportRow r : rows) {
        addCell(table, formatInvoiceNumber(r.invoiceNumber()), bodyFont, Element.ALIGN_LEFT);
        addCell(
            table,
            r.issuedAt() != null ? dateTimeFmt.format(r.issuedAt()) : "",
            bodyFont,
            Element.ALIGN_LEFT);
        addCell(table, r.clientName() != null ? r.clientName() : "", bodyFont, Element.ALIGN_LEFT);
        addCell(table, statusLabel(r.status()), bodyFont, Element.ALIGN_LEFT);
        addCell(table, sifenStatusLabel(r.sifenSubmissionStatus()), bodyFont, Element.ALIGN_LEFT);
        addCell(table, formatMoneyGs(r.total()), bodyFont, Element.ALIGN_RIGHT);
      }
      BigDecimal grandTotal = computeGrandTotal(rows);
      document.add(table);
      document.add(new Paragraph(" "));
      document.add(
          new Paragraph(
              "Comprobantes: "
                  + rows.size()
                  + "     Total emitido: "
                  + formatMoneyGs(grandTotal)
                  + "  (no incluye comprobantes rechazados por SIFEN)",
              boldFont));

      document.close();
      return baos.toByteArray();
    } catch (DocumentException | IOException e) {
      throw new IllegalStateException("Failed to build invoice history report PDF", e);
    }
  }

  private static void addCell(PdfPTable table, String text, Font font, int align) {
    PdfPCell cell = new PdfPCell(new Phrase(text != null ? text : "", font));
    cell.setHorizontalAlignment(align);
    cell.setPadding(4);
    table.addCell(cell);
  }

  private String dateRangeLabel(Instant from, Instant to, ZoneId zone) {
    DateTimeFormatter dateFmt =
        DateTimeFormatter.ofPattern("dd/MM/yyyy").withZone(zone).withLocale(ES_PY);
    String fromLabel = from != null ? dateFmt.format(from) : "-";
    String toLabel = to != null ? dateFmt.format(to) : "-";
    return "Periodo: " + fromLabel + " a " + toLabel;
  }

  // ── Excel (.xlsx) ──────────────────────────────────────────────────────────

  public byte[] renderXlsx(List<InvoiceReportRow> rows, Instant from, Instant to) {
    ZoneId zone = timeProperties.zoneId();
    DateTimeFormatter dateTimeFmt =
        DateTimeFormatter.ofPattern("dd/MM/yyyy HH:mm").withZone(zone).withLocale(ES_PY);
    try (Workbook wb = new XSSFWorkbook();
        ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
      Sheet sheet = wb.createSheet("Comprobantes");

      org.apache.poi.ss.usermodel.Font headerFont = wb.createFont();
      headerFont.setBold(true);
      CellStyle headerStyle = wb.createCellStyle();
      headerStyle.setFont(headerFont);

      Row periodRow = sheet.createRow(0);
      periodRow.createCell(0).setCellValue(dateRangeLabel(from, to, zone));

      String[] headers = {
        "Número", "Fecha de emisión", "Cliente", "Estado", "Estado SIFEN", "Total"
      };
      Row headerRow = sheet.createRow(2);
      for (int i = 0; i < headers.length; i++) {
        Cell c = headerRow.createCell(i);
        c.setCellValue(headers[i]);
        c.setCellStyle(headerStyle);
      }

      int rowIdx = 3;
      for (InvoiceReportRow r : rows) {
        Row row = sheet.createRow(rowIdx++);
        row.createCell(0).setCellValue(formatInvoiceNumber(r.invoiceNumber()));
        row.createCell(1)
            .setCellValue(r.issuedAt() != null ? dateTimeFmt.format(r.issuedAt()) : "");
        row.createCell(2).setCellValue(r.clientName() != null ? r.clientName() : "");
        row.createCell(3).setCellValue(statusLabel(r.status()));
        row.createCell(4).setCellValue(sifenStatusLabel(r.sifenSubmissionStatus()));
        row.createCell(5)
            .setCellValue(
                r.total() != null ? r.total().setScale(0, RoundingMode.HALF_UP).doubleValue() : 0d);
      }
      for (int i = 0; i < headers.length; i++) {
        sheet.autoSizeColumn(i);
      }

      wb.write(baos);
      return baos.toByteArray();
    } catch (IOException e) {
      throw new IllegalStateException("Failed to build invoice history report XLSX", e);
    }
  }

  // ── shared labels ─────────────────────────────────────────────────────────

  /**
   * "Total emitido": only valid facturación counts — an ISSUED comprobante still rejected by SIFEN
   * (not corrected/resent, not inutilizado) is provisional and excluded.
   */
  static BigDecimal computeGrandTotal(List<InvoiceReportRow> rows) {
    BigDecimal total = BigDecimal.ZERO;
    for (InvoiceReportRow r : rows) {
      if (r.status() == InvoiceStatus.ISSUED
          && r.total() != null
          && r.sifenSubmissionStatus() != SifenSubmissionStatus.REJECTED) {
        total = total.add(r.total());
      }
    }
    return total;
  }

  private static String formatInvoiceNumber(int number) {
    return String.format("%07d", number);
  }

  private static String statusLabel(InvoiceStatus status) {
    if (status == null) {
      return "";
    }
    return switch (status) {
      case ISSUED -> "Emitida";
      case VOIDED -> "Anulada";
    };
  }

  private static String sifenStatusLabel(SifenSubmissionStatus status) {
    if (status == null) {
      return "-";
    }
    return switch (status) {
      case QUEUED -> "En cola";
      case PENDING_VERIFICATION -> "Pendiente de verificación";
      case APPROVED -> "Aprobado";
      case APPROVED_WITH_OBSERVATION -> "Aprobado con observación";
      case REJECTED -> "Rechazado";
      case CANCELLED -> "Cancelado";
    };
  }

  private static String formatMoneyGs(BigDecimal v) {
    if (v == null) {
      return "Gs. 0";
    }
    DecimalFormatSymbols sym = DecimalFormatSymbols.getInstance(ES_PY);
    sym.setGroupingSeparator('.');
    DecimalFormat df = new DecimalFormat("#,##0", sym);
    df.setMaximumFractionDigits(0);
    df.setMinimumFractionDigits(0);
    return "Gs. " + df.format(v.setScale(0, RoundingMode.HALF_UP));
  }
}
