package com.cursorpoc.backend.commission;

import com.cursorpoc.backend.repository.BusinessProfileRepository;
import com.cursorpoc.backend.web.dto.CommissionDtos.EntryView;
import com.cursorpoc.backend.web.dto.CommissionDtos.SettlementDetail;
import com.cursorpoc.backend.web.dto.CommissionDtos.SettlementView;
import com.cursorpoc.backend.web.dto.CommissionDtos.Subtotal;
import com.lowagie.text.Document;
import com.lowagie.text.DocumentException;
import com.lowagie.text.Element;
import com.lowagie.text.Font;
import com.lowagie.text.PageSize;
import com.lowagie.text.Paragraph;
import com.lowagie.text.Phrase;
import com.lowagie.text.pdf.PdfPCell;
import com.lowagie.text.pdf.PdfPTable;
import com.lowagie.text.pdf.PdfWriter;
import java.io.ByteArrayOutputStream;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;
import org.springframework.stereotype.Service;

/** HU-COM-08: CSV exports and the printable settlement voucher (PDF). */
@Service
public class CommissionExportService {

  private final BusinessProfileRepository businessProfileRepository;
  private final CommissionConfigService configService;

  public CommissionExportService(
      BusinessProfileRepository businessProfileRepository, CommissionConfigService configService) {
    this.businessProfileRepository = businessProfileRepository;
    this.configService = configService;
  }

  /** Column headers and the type / reason / base / status values are in {@code lang}. */
  public byte[] entriesCsv(List<EntryView> entries, String lang) {
    CommissionExportLabels l = CommissionExportLabels.of(lang);
    ZoneId zone = configService.zone();
    DateTimeFormatter fmt = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm").withZone(zone);
    StringBuilder sb = new StringBuilder("\uFEFF");
    header(sb, l.entriesHeader());
    for (EntryView e : entries) {
      sb.append(e.id())
          .append(',')
          .append(fmt.format(e.accrualAt()))
          .append(',')
          .append(csv(e.professionalName()))
          .append(',')
          .append(csv(l.sourceType(e.sourceType())))
          .append(',')
          .append(csv(l.reason(e.reasonCode())))
          .append(',')
          .append(csv(e.invoiceNumber()))
          .append(',')
          .append(csv(e.itemName()))
          .append(',')
          .append(csv(l.kind(e.itemKind())))
          .append(',')
          .append(csv(l.base(e.baseType())))
          .append(',')
          .append(num(e.baseAmount()))
          .append(',')
          .append(num(e.percentApplied()))
          .append(',')
          .append(num(e.commissionAmount()))
          .append(',')
          .append(e.settlementId() == null ? "" : e.settlementId())
          .append(',')
          .append(csv(l.status(e.settlementStatus())))
          .append('\n');
    }
    return sb.toString().getBytes(StandardCharsets.UTF_8);
  }

  /** Column headers and the status values are in {@code lang}. */
  public byte[] settlementsCsv(List<SettlementView> settlements, String lang) {
    CommissionExportLabels l = CommissionExportLabels.of(lang);
    StringBuilder sb = new StringBuilder("\uFEFF");
    header(sb, l.settlementsHeader());
    for (SettlementView s : settlements) {
      sb.append(s.id())
          .append(',')
          .append(csv(s.professionalName()))
          .append(',')
          .append(s.periodFrom())
          .append(',')
          .append(s.periodTo())
          .append(',')
          .append(csv(l.status(s.status())))
          .append(',')
          .append(num(s.totalAmount()))
          .append(',')
          .append(csv(s.paymentMethod()))
          .append(',')
          .append(csv(s.paymentReference()))
          .append('\n');
    }
    return sb.toString().getBytes(StandardCharsets.UTF_8);
  }

  private static void header(StringBuilder sb, List<String> columns) {
    sb.append(String.join(",", columns.stream().map(CommissionExportService::csv).toList()))
        .append('\n');
  }

  public byte[] settlementPdf(long tenantId, SettlementDetail detail, String lang) {
    CommissionExportLabels l = CommissionExportLabels.of(lang);
    ZoneId zone = configService.zone();
    DateTimeFormatter dateFmt = DateTimeFormatter.ofPattern("dd/MM/yyyy");
    DateTimeFormatter dateTimeFmt = DateTimeFormatter.ofPattern("dd/MM/yyyy HH:mm").withZone(zone);
    SettlementView s = detail.settlement();
    String business =
        businessProfileRepository
            .findByTenantId(tenantId)
            .map(bp -> bp.getBusinessName())
            .orElse("");
    try (ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
      Document document = new Document(PageSize.A4, 36, 36, 36, 36);
      PdfWriter.getInstance(document, baos);
      document.open();
      Font title = new Font(Font.HELVETICA, 14, Font.BOLD);
      Font bold = new Font(Font.HELVETICA, 9, Font.BOLD);
      Font body = new Font(Font.HELVETICA, 9);
      document.add(new Paragraph(l.title(s.id()), title));
      document.add(new Paragraph(business, body));
      document.add(
          new Paragraph(l.professional() + ": " + nullToEmpty(s.professionalName()), body));
      document.add(
          new Paragraph(
              l.period()
                  + ": "
                  + dateFmt.format(s.periodFrom())
                  + " – "
                  + dateFmt.format(s.periodTo()),
              body));
      document.add(new Paragraph(l.statusLabel() + ": " + l.status(s.status()), body));
      String bases =
          detail.entries().stream()
              .map(EntryView::baseType)
              .filter(b -> b != null)
              .distinct()
              .map(l::base)
              .reduce((a, b) -> a + ", " + b)
              .orElse("-");
      document.add(new Paragraph(l.calculationBase() + ": " + bases, body));
      document.add(new Paragraph(" "));

      PdfPTable table = new PdfPTable(new float[] {14, 12, 26, 10, 10, 14, 6, 14});
      table.setWidthPercentage(100);
      for (String h : l.pdfTableHeader()) {
        cell(table, h, bold, Element.ALIGN_LEFT);
      }
      for (EntryView e : detail.entries()) {
        cell(table, dateTimeFmt.format(e.accrualAt()), body, Element.ALIGN_LEFT);
        cell(table, nullToEmpty(e.invoiceNumber()), body, Element.ALIGN_LEFT);
        cell(
            table,
            nullToEmpty(e.itemName())
                + ("REVERSAL".equals(e.sourceType()) ? l.reversalSuffix() : ""),
            body,
            Element.ALIGN_LEFT);
        cell(table, l.kind(e.itemKind()), body, Element.ALIGN_LEFT);
        cell(table, l.base(e.baseType()), body, Element.ALIGN_LEFT);
        cell(table, money(e.baseAmount()), body, Element.ALIGN_RIGHT);
        cell(table, num(e.percentApplied()), body, Element.ALIGN_RIGHT);
        cell(table, money(e.commissionAmount()), body, Element.ALIGN_RIGHT);
      }
      document.add(table);
      document.add(new Paragraph(" "));
      for (Subtotal st : detail.byKind()) {
        document.add(
            new Paragraph(
                l.subtotal() + " " + l.kindPlural(st.key()) + ": " + money(st.amount()), body));
      }
      for (EntryView a : detail.adjustments()) {
        document.add(
            new Paragraph(
                l.adjustment()
                    + ": "
                    + (a.note() != null ? a.note() : l.reason(a.reasonCode()))
                    + " "
                    + money(a.commissionAmount()),
                body));
      }
      document.add(new Paragraph(l.total() + ": " + money(s.totalAmount()), bold));
      if (s.paidAt() != null) {
        document.add(
            new Paragraph(
                l.paidOn()
                    + dateTimeFmt.format(s.paidAt())
                    + " ("
                    + nullToEmpty(s.paymentMethod())
                    + ")",
                body));
      }
      document.close();
      return baos.toByteArray();
    } catch (DocumentException | java.io.IOException e) {
      throw new IllegalStateException("Failed to build settlement PDF", e);
    }
  }

  private static void cell(PdfPTable table, String text, Font font, int align) {
    PdfPCell c = new PdfPCell(new Phrase(text, font));
    c.setHorizontalAlignment(align);
    c.setPadding(3);
    table.addCell(c);
  }

  static String money(BigDecimal v) {
    if (v == null) {
      return "";
    }
    DecimalFormat f =
        new DecimalFormat("#,##0", DecimalFormatSymbols.getInstance(Locale.of("es", "PY")));
    return "Gs. " + f.format(v.setScale(0, RoundingMode.HALF_UP));
  }

  private static String num(BigDecimal v) {
    return v == null ? "" : v.stripTrailingZeros().toPlainString();
  }

  private static String nullToEmpty(String s) {
    return s == null ? "" : s;
  }

  static String csv(String s) {
    if (s == null) {
      return "";
    }
    String escaped = s.replace("\"", "\"\"");
    return escaped.contains(",") || escaped.contains("\"") || escaped.contains("\n")
        ? "\"" + escaped + "\""
        : escaped;
  }
}
