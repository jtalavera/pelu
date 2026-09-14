package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.BusinessProfile;
import com.cursorpoc.backend.domain.SalonService;
import com.cursorpoc.backend.repository.BusinessProfileRepository;
import com.cursorpoc.backend.repository.SalonServiceRepository;
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
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.util.List;
import java.util.Locale;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Issue #217 "Lista de precios compartible": a simple PDF listing the tenant's active services and
 * their prices, meant to be shared with (or printed for) clients. Reuses the OpenPDF
 * (Document/PdfWriter/PdfPTable) pattern already established by {@link SifenKudePdfService} for the
 * KuDE — but is deliberately much simpler, since no SIFEN legal formatting requirements apply to
 * this document.
 */
@Service
public class ServicePriceListPdfService {

  private static final DecimalFormatSymbols MONEY_SYMBOLS = symbolsWithDotGrouping();

  private final SalonServiceRepository salonServiceRepository;
  private final BusinessProfileRepository businessProfileRepository;

  public ServicePriceListPdfService(
      SalonServiceRepository salonServiceRepository,
      BusinessProfileRepository businessProfileRepository) {
    this.salonServiceRepository = salonServiceRepository;
    this.businessProfileRepository = businessProfileRepository;
  }

  /** AC: only {@code active = true} services are included, ordered by name. */
  @Transactional(readOnly = true)
  public byte[] buildPriceListPdf(long tenantId) {
    List<SalonService> services =
        salonServiceRepository.findByTenant_IdAndActiveTrueOrderByNameAsc(tenantId);
    BusinessProfile profile = businessProfileRepository.findByTenantId(tenantId).orElse(null);
    return render(resolveHeaderName(profile), services);
  }

  /**
   * AC: the document header is the business's fantasy name (Business Settings → "Nombre de
   * fantasía"). Falls back to the (required) business name when no fantasy name is configured, so
   * the PDF always has a header.
   */
  static String resolveHeaderName(BusinessProfile profile) {
    if (profile == null) {
      return "";
    }
    if (hasText(profile.getSifenFantasyName())) {
      return profile.getSifenFantasyName();
    }
    return profile.getBusinessName() != null ? profile.getBusinessName() : "";
  }

  private byte[] render(String headerName, List<SalonService> services) {
    try {
      Document document = new Document(PageSize.A4, 36, 36, 36, 36);
      ByteArrayOutputStream baos = new ByteArrayOutputStream();
      PdfWriter.getInstance(document, baos);
      document.open();

      Font titleFont = new Font(Font.HELVETICA, 16, Font.BOLD);
      Font subtitleFont = new Font(Font.HELVETICA, 11, Font.NORMAL);
      Font headerCellFont = new Font(Font.HELVETICA, 10, Font.BOLD);
      Font bodyFont = new Font(Font.HELVETICA, 10);

      if (hasText(headerName)) {
        Paragraph title = new Paragraph(headerName, titleFont);
        title.setAlignment(Element.ALIGN_CENTER);
        document.add(title);
      }
      Paragraph subtitle = new Paragraph("Lista de precios", subtitleFont);
      subtitle.setAlignment(Element.ALIGN_CENTER);
      subtitle.setSpacingAfter(18);
      document.add(subtitle);

      PdfPTable table = new PdfPTable(2);
      table.setWidthPercentage(100);
      table.setWidths(new float[] {3f, 1f});
      addHeaderCell(table, "Servicio", headerCellFont);
      addHeaderCell(table, "Precio", headerCellFont);
      for (SalonService svc : services) {
        addCell(table, svc.getName(), bodyFont, Element.ALIGN_LEFT);
        addCell(table, formatGuaranies(svc.getPriceMinor()), bodyFont, Element.ALIGN_RIGHT);
      }
      document.add(table);

      document.close();
      return baos.toByteArray();
    } catch (DocumentException e) {
      throw new IllegalStateException("Failed to build price list PDF", e);
    }
  }

  private static void addHeaderCell(PdfPTable table, String text, Font font) {
    PdfPCell cell = new PdfPCell(new Phrase(text, font));
    cell.setGrayFill(0.9f);
    cell.setPadding(6);
    table.addCell(cell);
  }

  private static void addCell(PdfPTable table, String text, Font font, int align) {
    PdfPCell cell = new PdfPCell(new Phrase(text == null ? "" : text, font));
    cell.setHorizontalAlignment(align);
    cell.setPadding(6);
    table.addCell(cell);
  }

  /**
   * Same visual format the frontend's {@code formatGuaraniesGs} uses across the whole app: "Gs. " +
   * integer amount, dot as thousands separator, no decimals.
   */
  static String formatGuaranies(BigDecimal v) {
    if (v == null) {
      return "Gs. 0";
    }
    DecimalFormat df = new DecimalFormat("#,##0", MONEY_SYMBOLS);
    return "Gs. " + df.format(v.setScale(0, RoundingMode.HALF_UP));
  }

  private static DecimalFormatSymbols symbolsWithDotGrouping() {
    DecimalFormatSymbols sym = DecimalFormatSymbols.getInstance(Locale.forLanguageTag("es-PY"));
    sym.setGroupingSeparator('.');
    return sym;
  }

  private static boolean hasText(String s) {
    return s != null && !s.isBlank();
  }
}
