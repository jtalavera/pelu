package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.InvoiceLine;
import com.cursorpoc.backend.domain.InvoicePaymentAllocation;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.DiscountType;
import com.cursorpoc.backend.domain.enums.InvoiceStatus;
import com.cursorpoc.backend.repository.BusinessProfileRepository;
import com.cursorpoc.backend.repository.InvoiceRepository;
import com.lowagie.text.Document;
import com.lowagie.text.DocumentException;
import com.lowagie.text.Element;
import com.lowagie.text.Rectangle;
import com.lowagie.text.pdf.BaseFont;
import com.lowagie.text.pdf.PdfContentByte;
import com.lowagie.text.pdf.PdfWriter;
import java.io.ByteArrayOutputStream;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;
import org.hibernate.Hibernate;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Invoice PDF for continuous / pre-printed stock: sheet 23.5 cm × 14 cm, two identical copies side
 * by side (~11.75 cm each). Coordinates target blank fields on a typical Paraguayan factura form;
 * only variable data is drawn (no duplicate letterhead).
 */
@Service
public class InvoicePdfService {

  private static final float CM_PER_INCH = 2.54f;
  private static final float PT_PER_INCH = 72f;

  /** Sheet width: 23.5 cm (horizontal). */
  private static final float PAGE_WIDTH_PT = (23.5f * PT_PER_INCH) / CM_PER_INCH;

  /** Sheet height: 14 cm (vertical). */
  private static final float PAGE_HEIGHT_PT = (14f * PT_PER_INCH) / CM_PER_INCH;

  /** Half sheet = one invoice panel. */
  private static final float PANEL_WIDTH_PT = PAGE_WIDTH_PT / 2f;

  private static final float MARGIN_X_PT = cmToPt(0.35f);
  private static final float BODY_PT = 8f;
  private static final float TABLE_PT = 7.5f;
  private static final float FOOTER_PT = 7f;

  private final BusinessProfileRepository businessProfileRepository;
  private final InvoiceRepository invoiceRepository;
  private final BusinessProfileService businessProfileService;
  private final FemmeTimeProperties timeProperties;

  public InvoicePdfService(
      BusinessProfileRepository businessProfileRepository,
      InvoiceRepository invoiceRepository,
      BusinessProfileService businessProfileService,
      FemmeTimeProperties timeProperties) {
    this.businessProfileRepository = businessProfileRepository;
    this.invoiceRepository = invoiceRepository;
    this.businessProfileService = businessProfileService;
    this.timeProperties = timeProperties;
  }

  private static float cmToPt(float cm) {
    return (cm * PT_PER_INCH) / CM_PER_INCH;
  }

  /** PDF Y from bottom, given distance from physical top of page (cm). */
  private static float yFromTop(float pageHeightPt, float cmFromTop) {
    return pageHeightPt - cmToPt(cmFromTop);
  }

  @Transactional(readOnly = true)
  public byte[] buildInvoicePdf(long invoiceId, long tenantId) {
    if (!businessProfileService.isRucReadyForInvoicing(tenantId)) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "BUSINESS_RUC_REQUIRED_FOR_PDF");
    }
    Invoice invoice =
        invoiceRepository
            .findByIdAndTenant_Id(invoiceId, tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "INVOICE_NOT_FOUND"));
    if (invoice.getStatus() != InvoiceStatus.ISSUED) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVOICE_PDF_ONLY_FOR_ISSUED");
    }
    Tenant tenant = invoice.getTenant();
    if (tenant.getId() != tenantId) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "INVOICE_NOT_FOUND");
    }
    Hibernate.initialize(invoice.getLines());
    Hibernate.initialize(invoice.getPaymentAllocations());
    if (invoice.getClient() != null) {
      Hibernate.initialize(invoice.getClient());
    }
    for (InvoiceLine line : invoice.getLines()) {
      Hibernate.initialize(line.getSalonService());
    }
    businessProfileRepository
        .findByTenantId(tenantId)
        .orElseThrow(
            () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "BUSINESS_PROFILE_NOT_FOUND"));
    return renderPdf(invoice);
  }

  byte[] renderPdf(Invoice invoice) {
    ZoneId zone = timeProperties.zoneId();
    DateTimeFormatter dateFmt =
        DateTimeFormatter.ofPattern("dd/MM/yyyy")
            .withZone(zone)
            .withLocale(Locale.forLanguageTag("es-PY"));

    try {
      Rectangle pageSize = new Rectangle(PAGE_WIDTH_PT, PAGE_HEIGHT_PT);
      Document document = new Document(pageSize, 0, 0, 0, 0);
      ByteArrayOutputStream baos = new ByteArrayOutputStream();
      PdfWriter writer = PdfWriter.getInstance(document, baos);
      document.open();

      BaseFont bf = BaseFont.createFont(BaseFont.HELVETICA, BaseFont.CP1252, BaseFont.NOT_EMBEDDED);
      BaseFont bfBold =
          BaseFont.createFont(BaseFont.HELVETICA_BOLD, BaseFont.CP1252, BaseFont.NOT_EMBEDDED);

      PdfContentByte cb = writer.getDirectContent();
      drawPanel(cb, bf, bfBold, 0f, invoice, dateFmt, "COPIA: ARCHIVO TRIBUTARIO");
      drawPanel(cb, bf, bfBold, PANEL_WIDTH_PT, invoice, dateFmt, "ORIGINAL: ADQUIRENTE");

      document.close();
      return baos.toByteArray();
    } catch (Exception e) {
      if (e instanceof DocumentException de) {
        throw new IllegalStateException("Failed to build invoice PDF", de);
      }
      throw new IllegalStateException("Failed to build invoice PDF", e);
    }
  }

  private void drawPanel(
      PdfContentByte cb,
      BaseFont bf,
      BaseFont bfBold,
      float panelOriginX,
      Invoice invoice,
      DateTimeFormatter dateFmt,
      String copyFooter)
      throws Exception {
    float ox = panelOriginX + MARGIN_X_PT;
    float innerW = PANEL_WIDTH_PT - 2 * MARGIN_X_PT;
    float h = PAGE_HEIGHT_PT;
    DateTimeFormatter vigFmt = DateTimeFormatter.ofPattern("dd/MM/yyyy");

    // --- Header overlay (timbrado / número) — optional alignment with blank boxes on form ---
    cb.beginText();
    cb.setFontAndSize(bfBold, 8.5f);
    String stamp = invoice.getFiscalStamp().getStampNumber();
    cb.showTextAligned(Element.ALIGN_LEFT, "Timbrado Nº " + stamp, ox, yFromTop(h, 1.05f), 0);
    cb.setFontAndSize(bf, 7f);
    cb.showTextAligned(
        Element.ALIGN_LEFT,
        "Vigencia "
            + invoice.getFiscalStamp().getValidFrom().format(vigFmt)
            + " al "
            + invoice.getFiscalStamp().getValidUntil().format(vigFmt),
        ox,
        yFromTop(h, 1.45f),
        0);
    cb.setFontAndSize(bfBold, 9f);
    String invNo = formatInvoiceNumber(invoice.getInvoiceNumber());
    cb.showTextAligned(Element.ALIGN_RIGHT, "Nº " + invNo, ox + innerW, yFromTop(h, 2.05f), 0);
    cb.endText();

    // --- Client block (aligned with typical “Fecha / RUC / Nombre / Dirección / Tel”) ---
    cb.beginText();
    cb.setFontAndSize(bf, BODY_PT);
    cb.showTextAligned(
        Element.ALIGN_LEFT,
        dateFmt.format(invoice.getIssuedAt()),
        ox + cmToPt(2.2f),
        yFromTop(h, 3.05f),
        0);
    // Contado (POS): mark near printed “CONTADO”
    cb.showTextAligned(Element.ALIGN_LEFT, "X", ox + cmToPt(5.6f), yFromTop(h, 3.05f), 0);

    String clientRuc = invoice.getClientRucOverride();
    if (clientRuc == null || clientRuc.isBlank()) {
      Client c = invoice.getClient();
      if (c != null && c.getRuc() != null && !c.getRuc().isBlank()) {
        clientRuc = c.getRuc();
      }
    }
    if (clientRuc != null && !clientRuc.isBlank()) {
      cb.showTextAligned(Element.ALIGN_LEFT, truncate(clientRuc, 28), ox, yFromTop(h, 3.62f), 0);
    }

    String name = invoice.getClientDisplayName();
    if (name != null && !name.isBlank()) {
      cb.showTextAligned(Element.ALIGN_LEFT, truncate(name, 48), ox, yFromTop(h, 4.22f), 0);
    }

    String phone = "";
    Client cl = invoice.getClient();
    if (cl != null && cl.getPhone() != null && !cl.getPhone().isBlank()) {
      phone = cl.getPhone();
    }
    cb.showTextAligned(
        Element.ALIGN_LEFT, truncate(phone, 22), ox + cmToPt(6.2f), yFromTop(h, 4.82f), 0);
    cb.endText();

    // --- Detail table: Cant. | Descripción (nombre de servicio) | P. unit. | ventas 10% ---
    float tableTop = yFromTop(h, 5.55f);
    float rowH = cmToPt(0.38f);
    float xCant = ox;
    float xDesc = ox + cmToPt(0.85f);
    float xPu = ox + cmToPt(6.35f);
    float x10 = ox + cmToPt(9.05f);

    cb.beginText();
    cb.setFontAndSize(bfBold, TABLE_PT);
    cb.showTextAligned(Element.ALIGN_RIGHT, "Cant.", xCant + cmToPt(0.65f), tableTop, 0);
    cb.showTextAligned(Element.ALIGN_LEFT, "Descripción", xDesc, tableTop, 0);
    cb.showTextAligned(Element.ALIGN_RIGHT, "P. unit.", xPu + cmToPt(1.35f), tableTop, 0);
    cb.showTextAligned(Element.ALIGN_RIGHT, "10%", x10 + cmToPt(0.85f), tableTop, 0);
    cb.endText();

    List<InvoiceLine> lines = invoice.getLines();
    int maxRows = 11;
    float yRow = tableTop - rowH * 1.15f;
    cb.setFontAndSize(bf, TABLE_PT);
    int row = 0;
    for (InvoiceLine line : lines) {
      if (row >= maxRows) {
        break;
      }
      String desc = lineDescriptionForPrint(line);
      cb.beginText();
      cb.showTextAligned(
          Element.ALIGN_RIGHT, String.valueOf(line.getQuantity()), xCant + cmToPt(0.65f), yRow, 0);
      cb.showTextAligned(Element.ALIGN_LEFT, truncate(desc, 36), xDesc, yRow, 0);
      cb.showTextAligned(
          Element.ALIGN_RIGHT, formatMoneyGs(line.getUnitPrice()), xPu + cmToPt(1.35f), yRow, 0);
      cb.showTextAligned(
          Element.ALIGN_RIGHT, formatMoneyGs(line.getLineTotal()), x10 + cmToPt(0.85f), yRow, 0);
      cb.endText();
      yRow -= rowH;
      row++;
    }

    // --- Totals block ---
    float yPartial = yFromTop(h, 10.05f);
    float yTotal = yFromTop(h, 10.75f);
    float yIva = yFromTop(h, 11.45f);
    cb.beginText();
    cb.setFontAndSize(bf, BODY_PT);
    cb.showTextAligned(
        Element.ALIGN_RIGHT,
        formatMoneyGs(invoice.getSubtotal()),
        x10 + cmToPt(0.85f),
        yPartial,
        0);

    if (invoice.getDiscountType() != null
        && invoice.getDiscountType() != DiscountType.NONE
        && invoice.getDiscountValue() != null
        && invoice.getDiscountValue().compareTo(BigDecimal.ZERO) > 0) {
      cb.showTextAligned(
          Element.ALIGN_LEFT,
          "Dto. "
              + discountLabel(invoice.getDiscountType())
              + ": "
              + formatMoneyGs(invoice.getDiscountValue()),
          ox,
          yPartial - cmToPt(0.42f),
          0);
    }

    cb.setFontAndSize(bfBold, 9f);
    cb.showTextAligned(
        Element.ALIGN_RIGHT, formatMoneyGs(invoice.getTotal()), ox + innerW, yTotal, 0);

    cb.setFontAndSize(bf, 7f);
    BigDecimal iva10 = vatTenFromTotal(invoice.getTotal());
    cb.showTextAligned(Element.ALIGN_RIGHT, formatMoneyGs(iva10), x10 + cmToPt(0.85f), yIva, 0);
    cb.endText();

    // --- Payments (small, under totals) ---
    float yPay = yFromTop(h, 12.05f);
    StringBuilder pay = new StringBuilder();
    for (InvoicePaymentAllocation p : invoice.getPaymentAllocations()) {
      if (!pay.isEmpty()) {
        pay.append("  ");
      }
      pay.append(shortPaymentLabel(p)).append(" ").append(formatMoneyGs(p.getAmount()));
    }
    cb.beginText();
    cb.setFontAndSize(bf, 6.5f);
    cb.showTextAligned(Element.ALIGN_LEFT, truncate(pay.toString(), 72), ox, yPay, 0);
    cb.endText();

    // --- Copy designation (bottom of panel) ---
    cb.beginText();
    cb.setFontAndSize(bfBold, FOOTER_PT);
    cb.showTextAligned(
        Element.ALIGN_CENTER, copyFooter, panelOriginX + PANEL_WIDTH_PT / 2f, cmToPt(0.55f), 0);
    cb.endText();
  }

  /**
   * Visible “Descripción” on paper: service catalog name when linked; otherwise stored line text.
   */
  static String lineDescriptionForPrint(InvoiceLine line) {
    if (line.getSalonService() != null && line.getSalonService().getName() != null) {
      return line.getSalonService().getName().trim();
    }
    return line.getDescription() != null ? line.getDescription().trim() : "";
  }

  private static String formatInvoiceNumber(int number) {
    return String.format("%07d", number);
  }

  private static String discountLabel(com.cursorpoc.backend.domain.enums.DiscountType type) {
    return switch (type) {
      case PERCENT -> "%";
      case FIXED -> "Gs.";
      case NONE -> "";
    };
  }

  private static String shortPaymentLabel(InvoicePaymentAllocation p) {
    return switch (p.getMethod()) {
      case CASH -> "Efec.";
      case DEBIT_CARD -> "Deb.";
      case CREDIT_CARD -> "Cred.";
      case TRANSFER -> "Transf.";
      case OTHER -> "Otro";
    };
  }

  /**
   * Paraguay IVA 10% included in price: IVA = total / 11 (common shortcut for tax breakdown on
   * ticket).
   */
  private static BigDecimal vatTenFromTotal(BigDecimal total) {
    if (total == null || total.compareTo(BigDecimal.ZERO) <= 0) {
      return BigDecimal.ZERO;
    }
    return total.divide(BigDecimal.valueOf(11), 2, RoundingMode.HALF_UP);
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

  private static String truncate(String s, int maxChars) {
    if (s == null) {
      return "";
    }
    if (s.length() <= maxChars) {
      return s;
    }
    return s.substring(0, Math.max(1, maxChars - 1)) + ".";
  }
}
