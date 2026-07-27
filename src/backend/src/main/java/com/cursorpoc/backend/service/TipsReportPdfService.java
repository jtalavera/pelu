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

      boolean showSubtotals = rowsByProfessional.size() > 1;
      Map<Long, TipReportProfessionalTotalResponse> totalsById = new LinkedHashMap<>();
      for (TipReportProfessionalTotalResponse t : report.professionalTotals()) {
        totalsById.put(t.professionalId(), t);
      }

      for (Map.Entry<Long, List<TipReportRowResponse>> group : rowsByProfessional.entrySet()) {
        for (TipReportRowResponse row : group.getValue()) {
          addCell(table, row.professionalName(), bodyFont, Element.ALIGN_LEFT);
          addCell(table, formatMoneyGs(row.amount()), bodyFont, Element.ALIGN_RIGHT);
          addCell(table, row.clientName(), bodyFont, Element.ALIGN_LEFT);
          addCell(
              table,
              row.serviceDateTime() != null ? dateTimeFmt.format(row.serviceDateTime()) : "",
              bodyFont,
              Element.ALIGN_LEFT);
        }
        if (showSubtotals) {
          TipReportProfessionalTotalResponse total = totalsById.get(group.getKey());
          PdfPCell label =
              new PdfPCell(
                  new Phrase(
                      "Subtotal " + (total != null ? total.professionalName() : ""), boldFont));
          label.setColspan(1);
          label.setBorder(0);
          table.addCell(label);
          addCell(
              table,
              total != null ? formatMoneyGs(total.total()) : "",
              boldFont,
              Element.ALIGN_RIGHT);
          PdfPCell blank1 = new PdfPCell(new Phrase(""));
          blank1.setBorder(0);
          table.addCell(blank1);
          PdfPCell blank2 = new PdfPCell(new Phrase(""));
          blank2.setBorder(0);
          table.addCell(blank2);
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
      return "0";
    }
    DecimalFormatSymbols sym = DecimalFormatSymbols.getInstance(Locale.forLanguageTag("es-PY"));
    sym.setGroupingSeparator('.');
    DecimalFormat df = new DecimalFormat("#,##0", sym);
    df.setMaximumFractionDigits(0);
    df.setMinimumFractionDigits(0);
    return df.format(v.setScale(0, RoundingMode.HALF_UP));
  }
}
