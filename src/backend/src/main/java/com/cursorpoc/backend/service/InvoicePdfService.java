package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.InvoiceLine;
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
import java.util.ArrayList;
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

  // HU-29 AC5/AC6: the detail table has three equal-width tax columns —
  // Exenta (leftmost), IVA 5 %, and IVA 10 % (rightmost). Column widths and
  // anchors are calibrated to the production pre-printed factura stock
  // (requirements/invoice_format.png, 23.5 x 14 cm, ~552 px/cm scan).
  // Measured column right-edges from panel left: Exenta ~8.40 cm, IVA 5 %
  // ~10.12 cm, IVA 10 % ~11.68 cm. Equal-width formula errors < 0.10 cm.
  private static final float TAX_COL_WIDTH_CM = 1.60f;
  private static final float TAX_COL_10_ANCHOR_CM = 10.83f;

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
      drawPanel(cb, bf, bfBold, 0f, invoice, dateFmt);
      drawPanel(cb, bf, bfBold, PANEL_WIDTH_PT, invoice, dateFmt);

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
      DateTimeFormatter dateFmt)
      throws Exception {
    float ox = panelOriginX + MARGIN_X_PT;
    float h = PAGE_HEIGHT_PT;
    boolean isRightPanel = panelOriginX > 0;

    // --- Client block ---
    // Coordinates calibrated to the production pre-printed factura stock
    // (requirements/invoice_format.png, 23.5×14 cm, two panels).
    // Fecha / RUC value column starts at ~2.2 cm from panel edge.
    float fieldX = ox + cmToPt(2.2f);
    // Nombre o Razón Social label is wider; value starts at ~3.25 cm (left) / ~3.75 cm (right).
    float nameX = ox + cmToPt(isRightPanel ? 3.75f : 3.25f);
    cb.beginText();
    cb.setFontAndSize(bf, BODY_PT);
    cb.showTextAligned(
        Element.ALIGN_LEFT, dateFmt.format(invoice.getIssuedAt()), fieldX, yFromTop(h, 3.05f), 0);
    // Contado (POS): mark inside printed "CONTADO" box (~8.25 cm from panel edge).
    cb.showTextAligned(Element.ALIGN_LEFT, "X", ox + cmToPt(8.25f), yFromTop(h, 3.05f), 0);

    String clientRuc = invoice.getClientRucOverride();
    if (clientRuc == null || clientRuc.isBlank()) {
      Client c = invoice.getClient();
      if (c != null && c.getRuc() != null && !c.getRuc().isBlank()) {
        clientRuc = c.getRuc();
      }
    }
    if (clientRuc != null && !clientRuc.isBlank()) {
      cb.showTextAligned(
          Element.ALIGN_LEFT, truncate(clientRuc, 28), fieldX, yFromTop(h, 3.62f), 0);
    }

    String name = invoice.getClientDisplayName();
    if (name != null && !name.isBlank()) {
      cb.showTextAligned(Element.ALIGN_LEFT, truncate(name, 48), nameX, yFromTop(h, 4.11f), 0);
    }

    // Dirección row (y ~4.63 cm) — Teléfono value starts after the pre-printed
    // "Teléfono:" label (~7.8 cm from panel edge).
    String phone = "";
    Client cl = invoice.getClient();
    if (cl != null && cl.getPhone() != null && !cl.getPhone().isBlank()) {
      phone = cl.getPhone();
    }
    cb.showTextAligned(
        Element.ALIGN_LEFT, truncate(phone, 22), ox + cmToPt(7.8f), yFromTop(h, 4.63f), 0);
    cb.endText();

    // --- Detail table (variable rows only) ---
    // HU-21: column headers (Cant. / Descripción / P. unit. / 10%) are
    // pre-printed on the form, so the PDF prints only the row data.
    // Column x-positions calibrated to production form (invoice_format.png):
    // Cant. right ~0.66 cm, Desc left ~1.0 cm, P.Unit. right ~5.72 cm.
    // Table top at ~5.72 cm from top so first data row lands at ~6.16 cm.
    float tableTop = yFromTop(h, 5.72f);
    float rowH = cmToPt(0.38f);
    float xCant = ox;
    // Descripción starts just after the Cant. box divider (~1.0 cm).
    float xDesc = ox + cmToPt(1.0f);
    // Precio Unitario right-edge at ~5.72 cm (left) / ~6.22 cm (right) from panel left.
    float xPuAnchor = ox + cmToPt(isRightPanel ? 6.22f : 5.72f);
    float taxExtraCm = isRightPanel ? 0.5f : 0f;

    List<DetailRow> detailRows = buildDetailRows(invoice);
    BigDecimal[] colSubtotals = {BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO};
    for (DetailRow dr : detailRows) {
      for (int c = 0; c < 3; c++) {
        if (dr.columnAmounts()[c] != null) {
          colSubtotals[c] = colSubtotals[c].add(dr.columnAmounts()[c]);
        }
      }
    }

    int maxRows = 11;
    float yRow = tableTop - rowH * 1.15f;
    cb.setFontAndSize(bf, TABLE_PT);
    int row = 0;
    for (DetailRow dr : detailRows) {
      if (row >= maxRows) {
        break;
      }
      cb.beginText();
      if (dr.quantity() != null) {
        cb.showTextAligned(
            Element.ALIGN_RIGHT, String.valueOf(dr.quantity()), xCant + cmToPt(0.35f), yRow, 0);
      }
      cb.showTextAligned(Element.ALIGN_LEFT, truncate(dr.description(), 36), xDesc, yRow, 0);
      if (dr.unitPrice() != null) {
        cb.showTextAligned(Element.ALIGN_RIGHT, formatMoneyGs(dr.unitPrice()), xPuAnchor, yRow, 0);
      }
      for (int c = 0; c < 3; c++) {
        BigDecimal amount = dr.columnAmounts()[c];
        if (amount != null) {
          cb.showTextAligned(
              Element.ALIGN_RIGHT,
              formatSignedMoneyGs(amount),
              taxColumnAnchorX(ox, c, taxExtraCm),
              yRow,
              0);
        }
      }
      cb.endText();
      yRow -= rowH;
      row++;
    }

    // --- Totals block ---
    // Per-column subtotals row at ~12.19 cm from form top (Exenta, IVA 5%, IVA 10%).
    float yPartial = yFromTop(h, 12.19f);
    cb.beginText();
    cb.setFontAndSize(bf, BODY_PT);
    for (int c = 0; c < 3; c++) {
      if (colSubtotals[c].compareTo(BigDecimal.ZERO) != 0) {
        cb.showTextAligned(
            Element.ALIGN_RIGHT,
            formatSignedMoneyGs(colSubtotals[c]),
            taxColumnAnchorX(ox, c, taxExtraCm),
            yPartial,
            0);
      }
    }

    // IVA liquidation row at ~13.76 cm from top.
    // TOTAL IVA (IVA 5% + IVA 10%) printed 2.8 cm right of the IVA 10% field.
    cb.setFontAndSize(bf, 7f);
    float yIva = yFromTop(h, 13.76f);
    BigDecimal iva10 = computeIvaByRate(invoice, BigDecimal.valueOf(10));
    BigDecimal iva5 = computeIvaByRate(invoice, BigDecimal.valueOf(5));
    cb.showTextAligned(Element.ALIGN_RIGHT, formatMoneyGs(iva10), ox + cmToPt(7.43f), yIva, 0);
    if (iva5.compareTo(BigDecimal.ZERO) > 0) {
      cb.showTextAligned(Element.ALIGN_RIGHT, formatMoneyGs(iva5), ox + cmToPt(3.51f), yIva, 0);
    }
    BigDecimal totalIva = iva5.add(iva10);
    cb.showTextAligned(Element.ALIGN_RIGHT, formatMoneyGs(totalIva), ox + cmToPt(10.53f), yIva, 0);
    cb.endText();

    // HU-21: bottom-of-panel "COPIA: ARCHIVO TRIBUTARIO" / "ORIGINAL:
    // ADQUIRENTE" labels removed; the panel footer is left blank because
    // the printed form already differentiates the two copies.
  }

  /**
   * Visible "Descripción" on paper: service catalog name when linked; otherwise stored line text.
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

  /**
   * A single line printed in the detail table. {@code quantity}/{@code unitPrice} are non-null only
   * for item rows; {@code columnAmounts} holds the amount per tax column (index 0 = Exenta, 1 = IVA
   * 5 %, 2 = IVA 10 %), with {@code null} for empty columns and negative values for discounts.
   */
  record DetailRow(
      Integer quantity, String description, BigDecimal unitPrice, BigDecimal[] columnAmounts) {}

  /** Tax column index for a line's snapshot rate: 2 = IVA 10 %, 1 = IVA 5 %, 0 = Exenta/other. */
  static int taxColumnIndex(BigDecimal taxRate) {
    if (taxRate == null) {
      return 0;
    }
    if (taxRate.compareTo(BigDecimal.valueOf(10)) == 0) {
      return 2;
    }
    if (taxRate.compareTo(BigDecimal.valueOf(5)) == 0) {
      return 1;
    }
    return 0;
  }

  /** Right-edge X (absolute) where amounts in tax column {@code col} are right-aligned. */
  private static float taxColumnAnchorX(float ox, int col, float extraOffsetCm) {
    float fromTenColumnCm = (2 - col) * TAX_COL_WIDTH_CM;
    return ox + cmToPt(TAX_COL_10_ANCHOR_CM + extraOffsetCm - fromTenColumnCm);
  }

  /**
   * Builds the detail rows for the PDF (HU-29 AC5/AC6): each item prints its gross total in its tax
   * column; a per-item discount adds a second row with the negative discount in the same column; a
   * global discount adds one final row distributing the negative discount across the tax columns in
   * proportion to each column's net subtotal.
   */
  static List<DetailRow> buildDetailRows(Invoice invoice) {
    List<DetailRow> rows = new ArrayList<>();
    if (invoice.getLines() == null) {
      return rows;
    }
    BigDecimal[] netByColumn = {BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO};
    for (InvoiceLine line : invoice.getLines()) {
      int col = taxColumnIndex(line.getTaxRate());
      BigDecimal gross = line.getUnitPrice().multiply(BigDecimal.valueOf(line.getQuantity()));
      BigDecimal[] amounts = new BigDecimal[3];
      amounts[col] = gross;
      rows.add(
          new DetailRow(
              line.getQuantity(), lineDescriptionForPrint(line), line.getUnitPrice(), amounts));

      BigDecimal net = line.getLineTotal() != null ? line.getLineTotal() : gross;
      netByColumn[col] = netByColumn[col].add(net);

      BigDecimal discount = gross.subtract(net);
      if (line.getDiscountType() != null
          && line.getDiscountType() != DiscountType.NONE
          && discount.compareTo(BigDecimal.ZERO) > 0) {
        BigDecimal[] discAmounts = new BigDecimal[3];
        discAmounts[col] = discount.negate();
        rows.add(
            new DetailRow(
                null,
                lineDescriptionForPrint(line)
                    + " "
                    + lineDiscountDescription(line.getDiscountType(), line.getDiscountValue()),
                null,
                discAmounts));
      }
    }

    // Global (invoice-level) discount: subtotal is the net-of-item-discounts sum.
    BigDecimal globalDiscount =
        invoice.getSubtotal() != null && invoice.getTotal() != null
            ? invoice.getSubtotal().subtract(invoice.getTotal())
            : BigDecimal.ZERO;
    if (invoice.getDiscountType() != null
        && invoice.getDiscountType() != DiscountType.NONE
        && globalDiscount.compareTo(BigDecimal.ZERO) > 0) {
      BigDecimal[] split = distributeGlobalDiscount(globalDiscount, netByColumn);
      rows.add(
          new DetailRow(
              null,
              "Dto. global "
                  + lineDiscountDescription(invoice.getDiscountType(), invoice.getDiscountValue()),
              null,
              split));
    }
    return rows;
  }

  /** "Dto. 10%" for PERCENT, "Dto. 25.000 Gs." for FIXED. */
  private static String lineDiscountDescription(DiscountType type, BigDecimal value) {
    if (value == null) {
      return "Dto.";
    }
    return switch (type) {
      case PERCENT -> "Dto. " + value.stripTrailingZeros().toPlainString() + "%";
      case FIXED -> "Dto. " + formatMoneyGs(value) + " Gs.";
      case NONE -> "Dto.";
    };
  }

  /**
   * Distributes a positive {@code globalDiscount} (in whole guaraníes) across the three tax columns
   * proportionally to each column's net subtotal, returning negative amounts. Any rounding
   * remainder is added to the largest contributing column so the parts sum exactly to the discount.
   */
  static BigDecimal[] distributeGlobalDiscount(
      BigDecimal globalDiscount, BigDecimal[] netByColumn) {
    BigDecimal discount = globalDiscount.setScale(0, RoundingMode.HALF_UP);
    BigDecimal totalNet = netByColumn[0].add(netByColumn[1]).add(netByColumn[2]);
    BigDecimal[] out = new BigDecimal[3];
    if (totalNet.compareTo(BigDecimal.ZERO) <= 0) {
      return out;
    }
    BigDecimal allocated = BigDecimal.ZERO;
    int largestCol = -1;
    for (int i = 0; i < 3; i++) {
      if (netByColumn[i].compareTo(BigDecimal.ZERO) > 0) {
        BigDecimal part =
            discount.multiply(netByColumn[i]).divide(totalNet, 0, RoundingMode.HALF_UP);
        out[i] = part;
        allocated = allocated.add(part);
        if (largestCol < 0 || netByColumn[i].compareTo(netByColumn[largestCol]) > 0) {
          largestCol = i;
        }
      }
    }
    BigDecimal remainder = discount.subtract(allocated);
    if (largestCol >= 0 && remainder.compareTo(BigDecimal.ZERO) != 0) {
      out[largestCol] = out[largestCol].add(remainder);
    }
    for (int i = 0; i < 3; i++) {
      if (out[i] != null) {
        out[i] = out[i].negate();
      }
    }
    return out;
  }

  /** Money with an explicit leading minus for negatives (e.g. "-25.000"). */
  private static String formatSignedMoneyGs(BigDecimal v) {
    if (v == null) {
      return "0";
    }
    if (v.compareTo(BigDecimal.ZERO) < 0) {
      return "-" + formatMoneyGs(v.abs());
    }
    return formatMoneyGs(v);
  }

  /**
   * Sum of persisted tax amounts for lines whose tax rate equals {@code rate}, rounded to 0
   * decimals. Falls back to the legacy total/11 formula for invoices that predate V11 (where
   * taxAmount is null on all lines).
   */
  private static BigDecimal computeIvaByRate(Invoice invoice, BigDecimal rate) {
    if (invoice.getLines() == null || invoice.getLines().isEmpty()) {
      return BigDecimal.ZERO;
    }
    boolean hasTaxData = invoice.getLines().stream().anyMatch(l -> l.getTaxAmount() != null);
    if (!hasTaxData) {
      // Legacy invoice: fall back to IVA 10% = total / 11
      if (rate.compareTo(BigDecimal.valueOf(10)) == 0) {
        return vatTenFromTotal(invoice.getTotal());
      }
      return BigDecimal.ZERO;
    }
    BigDecimal sum =
        invoice.getLines().stream()
            .filter(
                l ->
                    l.getTaxRate() != null
                        && l.getTaxRate().compareTo(rate.setScale(4, RoundingMode.HALF_UP)) == 0
                        && l.getTaxAmount() != null)
            .map(InvoiceLine::getTaxAmount)
            .reduce(BigDecimal.ZERO, BigDecimal::add);
    return sum.setScale(0, RoundingMode.HALF_UP);
  }

  /**
   * Paraguay IVA 10% included in price: IVA = total / 11 (legacy fallback for pre-V11 invoices).
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
