package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.web.dto.TipReportProfessionalTotalResponse;
import com.cursorpoc.backend.web.dto.TipReportResponse;
import com.cursorpoc.backend.web.dto.TipReportRowResponse;
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
import java.awt.Color;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.stereotype.Service;

/** Tabular "Reporte de propinas" PDF: grouped by professional, sorted by service date/time. */
@Service
public class TipsReportPdfService {

  private final FemmeTimeProperties timeProperties;

  public TipsReportPdfService(FemmeTimeProperties timeProperties) {
    this.timeProperties = timeProperties;
  }

  public byte[] render(TipReportResponse report, Instant from, Instant to) {
    ZoneId zone = timeProperties.zoneId();
    DateTimeFormatter dateTimeFmt =
        DateTimeFormatter.ofPattern("dd/MM/yyyy HH:mm")
            .withZone(zone)
            .withLocale(Locale.forLanguageTag("es-PY"));

    try {
      Document document = new Document(PageSize.A4, 24, 24, 32, 32);
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
      Font redBoldFont = new Font(bfBold, 9, Font.NORMAL, Color.RED);

      document.add(new Paragraph("Reporte de propinas", titleFont));
      document.add(new Paragraph(dateRangeLabel(from, to, zone), bodyFont));
      document.add(new Paragraph(" "));

      PdfPTable table = new PdfPTable(new float[] {3f, 1.5f, 3f, 2.5f});
      table.setWidthPercentage(100);
      addHeaderCell(table, "Profesional", headerFont);
      addHeaderCell(table, "Monto propina", headerFont);
      addHeaderCell(table, "Cliente", headerFont);
      addHeaderCell(table, "Fecha y hora de servicio", headerFont);

      Map<Long, List<TipReportRowResponse>> rowsByProfessional = new LinkedHashMap<>();
      for (TipReportRowResponse row : report.rows()) {
        rowsByProfessional.computeIfAbsent(row.professionalId(), k -> new ArrayList<>()).add(row);
      }
      Map<Long, TipReportProfessionalTotalResponse> withdrawalsById = new LinkedHashMap<>();
      for (TipReportProfessionalTotalResponse w : report.withdrawalsByProfessional()) {
        withdrawalsById.put(w.professionalId(), w);
      }

      // Iterate professionalTotals (not rowsByProfessional) — a professional can appear here with
      // only a withdrawal and no tip rows in the window (see TipsService#getReport), and must
      // still get their own group/subtotal instead of silently disappearing from the PDF.
      boolean showSubtotals = report.professionalTotals().size() > 1;

      for (TipReportProfessionalTotalResponse total : report.professionalTotals()) {
        for (TipReportRowResponse row :
            rowsByProfessional.getOrDefault(total.professionalId(), List.of())) {
          addCell(table, row.professionalName(), bodyFont, Element.ALIGN_LEFT);
          addCell(table, formatMoneyGs(row.amount()), bodyFont, Element.ALIGN_RIGHT);
          addCell(table, row.clientName(), bodyFont, Element.ALIGN_LEFT);
          addCell(
              table,
              row.serviceDateTime() != null ? dateTimeFmt.format(row.serviceDateTime()) : "",
              bodyFont,
              Element.ALIGN_LEFT);
        }
        TipReportProfessionalTotalResponse withdrawal = withdrawalsById.get(total.professionalId());
        if (withdrawal != null) {
          addCell(
              table,
              "Retiro manual - " + withdrawal.professionalName(),
              redBoldFont,
              Element.ALIGN_LEFT);
          addCell(table, formatMoneyGs(withdrawal.total()), redBoldFont, Element.ALIGN_RIGHT);
          addBlankCell(table);
          addBlankCell(table);
        }
        if (showSubtotals) {
          addCell(table, "Subtotal " + total.professionalName(), boldFont, Element.ALIGN_LEFT);
          addCell(table, formatMoneyGs(total.total()), boldFont, Element.ALIGN_RIGHT);
          addBlankCell(table);
          addBlankCell(table);
        }
      }

      document.add(table);
      document.add(new Paragraph(" "));
      document.add(new Paragraph("Total general: " + formatMoneyGs(report.grandTotal()), boldFont));

      document.close();
      return baos.toByteArray();
    } catch (DocumentException | IOException e) {
      throw new IllegalStateException("Failed to build tips report PDF", e);
    }
  }

  private static void addHeaderCell(PdfPTable table, String text, Font font) {
    PdfPCell cell = new PdfPCell(new Phrase(text, font));
    cell.setHorizontalAlignment(Element.ALIGN_LEFT);
    cell.setPadding(4);
    table.addCell(cell);
  }

  private static void addCell(PdfPTable table, String text, Font font, int align) {
    PdfPCell cell = new PdfPCell(new Phrase(text != null ? text : "", font));
    cell.setHorizontalAlignment(align);
    cell.setPadding(4);
    table.addCell(cell);
  }

  private static void addBlankCell(PdfPTable table) {
    PdfPCell cell = new PdfPCell(new Phrase(""));
    cell.setBorder(0);
    table.addCell(cell);
  }

  private String dateRangeLabel(Instant from, Instant to, ZoneId zone) {
    DateTimeFormatter dateFmt =
        DateTimeFormatter.ofPattern("dd/MM/yyyy")
            .withZone(zone)
            .withLocale(Locale.forLanguageTag("es-PY"));
    String fromLabel = from != null ? dateFmt.format(from) : "-";
    String toLabel = to != null ? dateFmt.format(to) : "-";
    return "Periodo: " + fromLabel + " a " + toLabel;
  }

  private static String formatMoneyGs(BigDecimal v) {
    if (v == null) {
      return "Gs. 0";
    }
    DecimalFormatSymbols sym = DecimalFormatSymbols.getInstance(Locale.forLanguageTag("es-PY"));
    sym.setGroupingSeparator('.');
    DecimalFormat df = new DecimalFormat("#,##0", sym);
    df.setMaximumFractionDigits(0);
    df.setMinimumFractionDigits(0);
    return "Gs. " + df.format(v.setScale(0, RoundingMode.HALF_UP));
  }
}
