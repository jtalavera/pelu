package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.BusinessProfile;
import com.cursorpoc.backend.domain.SalonService;
import com.cursorpoc.backend.domain.enums.ServiceKind;
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
 * their prices (and, in a separate "Productos" section, the active products), meant to be shared
 * with (or printed for) clients. Reuses the OpenPDF (Document/PdfWriter/PdfPTable) pattern already
 * established by {@link SifenKudePdfService} for the KuDE — but is deliberately much simpler, since
 * no SIFEN legal formatting requirements apply to this document.
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

  /** Both kinds, in separate "Servicios" / "Productos" sections. */
  @Transactional(readOnly = true)
  public byte[] buildPriceListPdf(long tenantId) {
    return buildPriceListPdf(tenantId, null);
  }

  /**
   * AC: only {@code active = true} items are included, ordered by name. {@code kind} ("SERVICE" /
   * "PRODUCT", case-insensitive) restricts the list to that kind and the document carries a single
   * table — the Servicios screen downloads only services and the Productos screen only products. A
   * null/blank {@code kind} keeps both, in separate sections; anything else is a 400 {@code
   * INVALID_SERVICE_KIND}.
   */
  @Transactional(readOnly = true)
  public byte[] buildPriceListPdf(long tenantId, String kind) {
    ServiceKind kindFilter =
        kind == null || kind.isBlank() ? null : ServiceCatalogService.parseKind(kind);
    List<SalonService> services =
        salonServiceRepository.findByTenant_IdAndActiveTrueOrderByNameAsc(tenantId).stream()
            .filter(
                s ->
                    kindFilter == null
                        || (kindFilter == ServiceKind.PRODUCT)
                            == (s.getKind() == ServiceKind.PRODUCT))
            .toList();
    BusinessProfile profile = businessProfileRepository.findByTenantId(tenantId).orElse(null);
    return render(resolveHeaderName(profile), services, kindFilter);
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

  private byte[] render(String headerName, List<SalonService> services, ServiceKind kindFilter) {
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
      String subtitleText =
          kindFilter == ServiceKind.SERVICE
              ? "Lista de precios de servicios"
              : kindFilter == ServiceKind.PRODUCT
                  ? "Lista de precios de productos"
                  : "Lista de precios";
      Paragraph subtitle = new Paragraph(subtitleText, subtitleFont);
      subtitle.setAlignment(Element.ALIGN_CENTER);
      subtitle.setSpacingAfter(18);
      document.add(subtitle);

      List<SalonService> serviceItems =
          services.stream().filter(s -> s.getKind() != ServiceKind.PRODUCT).toList();
      List<SalonService> productItems =
          services.stream().filter(s -> s.getKind() == ServiceKind.PRODUCT).toList();

      // Separate sections; an empty section is omitted (the requested kind's one — "Servicios" when
      // unfiltered — always stays so the document never comes out blank). The section title is only
      // drawn when both sections share the page.
      boolean showServices =
          kindFilter == ServiceKind.SERVICE
              || (kindFilter == null && (!serviceItems.isEmpty() || productItems.isEmpty()));
      boolean showProducts =
          kindFilter == ServiceKind.PRODUCT || (kindFilter == null && !productItems.isEmpty());
      Font sectionFont = new Font(Font.HELVETICA, 12, Font.BOLD);
      if (showServices) {
        addSection(
            document,
            "Servicios",
            "Servicio",
            serviceItems,
            sectionFont,
            headerCellFont,
            bodyFont,
            showProducts);
      }
      if (showProducts) {
        addSection(
            document,
            "Productos",
            "Producto",
            productItems,
            sectionFont,
            headerCellFont,
            bodyFont,
            showServices);
      }

      document.close();
      return baos.toByteArray();
    } catch (DocumentException e) {
      throw new IllegalStateException("Failed to build price list PDF", e);
    }
  }

  private static void addSection(
      Document document,
      String sectionTitle,
      String nameColumn,
      List<SalonService> items,
      Font sectionFont,
      Font headerCellFont,
      Font bodyFont,
      boolean titled)
      throws DocumentException {
    if (titled) {
      Paragraph heading = new Paragraph(sectionTitle, sectionFont);
      heading.setSpacingBefore(10);
      heading.setSpacingAfter(6);
      document.add(heading);
    }
    PdfPTable table = new PdfPTable(2);
    table.setWidthPercentage(100);
    table.setWidths(new float[] {3f, 1f});
    addHeaderCell(table, nameColumn, headerCellFont);
    addHeaderCell(table, "Precio", headerCellFont);
    for (SalonService svc : items) {
      addCell(table, svc.getName(), bodyFont, Element.ALIGN_LEFT);
      addCell(table, formatGuaranies(svc.getPriceMinor()), bodyFont, Element.ALIGN_RIGHT);
    }
    document.add(table);
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
