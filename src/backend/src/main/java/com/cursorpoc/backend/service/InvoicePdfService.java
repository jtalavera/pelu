package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.InvoiceLine;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.DiscountType;
import com.cursorpoc.backend.domain.enums.InvoiceStatus;
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
 * Invoice PDF for continuous / pre-printed stock: sheet 756×424 pt (≈26.67×14.96 cm), two identical
 * copies side by side. Coordinates match requirements/factura_vieja_femme.pdf exactly so that
 * variable data lands in the correct blank fields of the physical pre-printed form. Only variable
 * data is drawn (no letterhead, invoice number, timbrado, or copy labels — those are pre-printed).
 */
@Service
public class InvoicePdfService {

  /**
   * Sheet width: 756 pt ≈ 26.67 cm (landscape). Matches factura_vieja_femme.pdf MediaBox [0 0 424
   * 756] + /Rotate 90.
   */
  static final float PAGE_WIDTH_PT = 756f;

  /** Sheet height: 424 pt ≈ 14.96 cm. */
  static final float PAGE_HEIGHT_PT = 424f;

  /** Body font size (client block, subtotals, IVA row, amount in words). */
  private static final float BODY_PT = 8f;

  /** Detail row font size. */
  private static final float TABLE_PT = 7f;

  /**
   * Width in points of each tax column (Exenta / IVA 5% / IVA 10%). Columns step left from the
   * IVA-10% anchor by this amount per column index. Calibrated to
   * requirements/factura_vieja_femme.pdf.
   */
  private static final float TAX_COL_WIDTH_PT = 45f;

  // ---------------------------------------------------------------------------
  // Per-panel absolute coordinates (bottom-left origin, points).
  // Measured from requirements/factura_vieja_femme.pdf — the authoritative layout.
  // Left panel: x ≈ 1–254.   Right panel: x ≈ 314–584.
  // ---------------------------------------------------------------------------

  // --- Client block ---
  static final float L_X_DATE = -5.02f;
  static final float L_Y_DATE = 347.04f;
  static final float L_X_CONTADO = 196.82f;
  static final float L_Y_CONTADO = 352.05f;
  static final float L_X_RUC = -10.02f;
  static final float L_Y_RUC = 334.87f;
  static final float L_X_NAME = 54.49f;
  static final float L_Y_NAME = 321.04f;

  static final float R_X_DATE = 326.83f;
  static final float R_Y_DATE = 350.87f;
  static final float R_X_CONTADO = 529.49f;
  static final float R_Y_CONTADO = 356.54f;
  static final float R_X_RUC = 324.65f;
  static final float R_Y_RUC = 335.87f;
  static final float R_X_NAME = 385.83f;
  static final float R_Y_NAME = 321.87f;

  // --- Detail table ---
  // Description is ALIGN_LEFT on both panels (Issue #86); unit price is CENTER-aligned on the
  // left panel and LEFT-aligned on the right panel. IVA-10% column anchor is shared by every
  // detail row and offset left/right by TAX_COL_WIDTH_PT to derive the Exenta/5% columns.
  // Both panels: first data row shares TABLE_FIRST_ROW_Y, step −13 pt per row. Issue #90: a
  // description longer than DESC_MAX_CHARS_PER_LINE is truncated to that length (never wraps).
  static final float L_X_QTY = -25.91f;
  static final float L_X_DESC_LEFT = -6.58f; // ALIGN_LEFT (Issue #86)
  static final float L_X_UNIT_CENTER = 98.48f; // ALIGN_CENTER center point
  static final float L_X_TAX_COL10 = 234.16f; // IVA-10% left-edge anchor

  static final float R_X_QTY = 299.83f;
  static final float R_X_DESC = 324.83f; // ALIGN_LEFT
  static final float R_X_UNIT = 439.67f; // ALIGN_LEFT
  static final float R_X_TAX_COL10 = 565.34f;

  /**
   * Subtotals-row anchor for the IVA-10% column (a.k.a. "Monto total" — the merchandise value
   * summed across all detail rows). Split from {@link #L_X_TAX_COL10}/{@link #R_X_TAX_COL10}
   * because the subtotals row and the detail rows now require independent x-offsets.
   */
  static final float L_X_SUBTOTAL_TAX10 = 239.83f;

  static final float R_X_SUBTOTAL_TAX10 = 565.34f;

  static final float TABLE_FIRST_ROW_Y = 265.04f;
  static final float ROW_STEP_PT = 13f;
  static final int MAX_ROWS = 11;

  /** Issue #90: max characters printed for a detail row description; longer text is truncated. */
  static final int DESC_MAX_CHARS_PER_LINE = 18;

  /**
   * Issue #94: the global-discount row has no unit price, freeing up horizontal room before the tax
   * columns — enough to print "Dto. global Monto fijo" (22 chars) without truncation.
   */
  static final int GLOBAL_DISCOUNT_DESC_MAX_CHARS = 24;

  // --- Subtotals row ---
  static final float L_Y_SUBTOTALS = 103.36f;
  static final float R_Y_SUBTOTALS = 106.9f;

  // --- Amount in words ---
  static final float L_X_WORDS = 29.35f;
  static final float L_Y_WORDS = 81.2f;
  static final float R_X_WORDS = 362.34f;
  static final float R_Y_WORDS = 84.87f;

  // --- IVA liquidation row ---
  // IVA 5% anchor is not present in the reference sample (all items were IVA 10%);
  // it is estimated at ~88 pt left of the IVA-10% anchor.
  static final float L_X_IVA5 = 76f;
  static final float L_X_IVA10 = 149.83f;
  static final float L_X_TOTAL_IVA = 238.83f;
  static final float L_Y_IVA = 63.36f;

  static final float R_X_IVA5 = 374f;
  static final float R_X_IVA10 = 479.01f;
  static final float R_X_TOTAL_IVA = 567.01f;
  static final float R_Y_IVA = 62.53f;

  private final InvoiceRepository invoiceRepository;
  private final BusinessProfileService businessProfileService;
  private final FemmeTimeProperties timeProperties;

  public InvoicePdfService(
      InvoiceRepository invoiceRepository,
      BusinessProfileService businessProfileService,
      FemmeTimeProperties timeProperties) {
    this.invoiceRepository = invoiceRepository;
    this.businessProfileService = businessProfileService;
    this.timeProperties = timeProperties;
  }

  @Transactional(readOnly = true)
  public InvoicePdfResult buildInvoicePdf(long invoiceId, long tenantId) {
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
    return new InvoicePdfResult(renderPdf(invoice), buildFilename(invoice));
  }

  /** Result of building an invoice PDF: the rendered bytes and the proposed download filename. */
  public record InvoicePdfResult(byte[] bytes, String filename) {}

  /**
   * Issue #84: proposed filename for the invoice PDF, in the format {@code
   * FACTURA-<yyyymmdd>-<timbrado>-<numero de comprobante>.pdf}, where the emission date is rendered
   * in the tenant's business timezone (same zone used to print the date on the PDF).
   */
  String buildFilename(Invoice invoice) {
    DateTimeFormatter fileDateFmt =
        DateTimeFormatter.ofPattern("yyyyMMdd").withZone(timeProperties.zoneId());
    String date = fileDateFmt.format(invoice.getIssuedAt());
    String stampNumber = invoice.getFiscalStamp().getStampNumber();
    String invoiceNumber = String.format("%07d", invoice.getInvoiceNumber());
    return "FACTURA-" + date + "-" + stampNumber + "-" + invoiceNumber + ".pdf";
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

      PdfContentByte cb = writer.getDirectContent();
      drawPanel(cb, bf, true, invoice, dateFmt);
      drawPanel(cb, bf, false, invoice, dateFmt);

      document.close();
      return baos.toByteArray();
    } catch (Exception e) {
      if (e instanceof DocumentException de) {
        throw new IllegalStateException("Failed to build invoice PDF", de);
      }
      throw new IllegalStateException("Failed to build invoice PDF", e);
    }
  }

  /**
   * Draws one copy of the invoice onto {@code cb}. {@code isLeft=true} draws the left panel (x ≈
   * 1–254); {@code isLeft=false} draws the right panel (x ≈ 314–584). Absolute coordinates are
   * taken directly from requirements/factura_vieja_femme.pdf.
   */
  private void drawPanel(
      PdfContentByte cb, BaseFont bf, boolean isLeft, Invoice invoice, DateTimeFormatter dateFmt)
      throws Exception {

    // Pick per-panel coordinate set
    float xDate = isLeft ? L_X_DATE : R_X_DATE;
    float yDate = isLeft ? L_Y_DATE : R_Y_DATE;
    float xContado = isLeft ? L_X_CONTADO : R_X_CONTADO;
    float yContado = isLeft ? L_Y_CONTADO : R_Y_CONTADO;
    float xRuc = isLeft ? L_X_RUC : R_X_RUC;
    float yRuc = isLeft ? L_Y_RUC : R_Y_RUC;
    float xName = isLeft ? L_X_NAME : R_X_NAME;
    float yName = isLeft ? L_Y_NAME : R_Y_NAME;

    float xQty = isLeft ? L_X_QTY : R_X_QTY;
    // Issue #86: descriptions are LEFT-aligned on both panels.
    // Unit price: left panel is still CENTER-aligned at a fixed center point; right panel is
    // LEFT-aligned at a fixed left edge.
    float xDescAnchor = isLeft ? L_X_DESC_LEFT : R_X_DESC;
    float xUnitAnchor = isLeft ? L_X_UNIT_CENTER : R_X_UNIT;
    float xTaxCol10 = isLeft ? L_X_TAX_COL10 : R_X_TAX_COL10;
    float xSubtotalTax10 = isLeft ? L_X_SUBTOTAL_TAX10 : R_X_SUBTOTAL_TAX10;
    int descAlign = Element.ALIGN_LEFT;
    int unitAlign = isLeft ? Element.ALIGN_CENTER : Element.ALIGN_LEFT;

    float ySubtotals = isLeft ? L_Y_SUBTOTALS : R_Y_SUBTOTALS;
    float xWords = isLeft ? L_X_WORDS : R_X_WORDS;
    float yWords = isLeft ? L_Y_WORDS : R_Y_WORDS;
    float xIva5 = isLeft ? L_X_IVA5 : R_X_IVA5;
    float xIva10 = isLeft ? L_X_IVA10 : R_X_IVA10;
    float xTotalIva = isLeft ? L_X_TOTAL_IVA : R_X_TOTAL_IVA;
    float yIva = isLeft ? L_Y_IVA : R_Y_IVA;

    // --- Client block ---
    cb.beginText();
    cb.setFontAndSize(bf, BODY_PT);
    cb.showTextAligned(Element.ALIGN_LEFT, dateFmt.format(invoice.getIssuedAt()), xDate, yDate, 0);
    // Contado (POS): mark "X" inside the pre-printed "CONTADO" checkbox.
    cb.showTextAligned(Element.ALIGN_LEFT, "X", xContado, yContado, 0);

    // Issue #96: the client's profile RUC is never used as a fallback here — a blank override
    // means the printed RUC stays blank, even if the selected client has one on file.
    String clientRuc = invoice.getClientRucOverride();
    if (clientRuc != null && !clientRuc.isBlank()) {
      cb.showTextAligned(Element.ALIGN_LEFT, truncate(clientRuc, 28), xRuc, yRuc, 0);
    }

    String name = invoice.getClientDisplayName();
    if (name != null && !name.isBlank()) {
      cb.showTextAligned(Element.ALIGN_LEFT, truncate(name, 48), xName, yName, 0);
    } else if (invoice.getClient() != null) {
      // Issue #96: a client was selected but the display name was left blank.
      cb.showTextAligned(Element.ALIGN_LEFT, "Sin nombre", xName, yName, 0);
    }
    cb.endText();

    // --- Detail table ---
    // Column headers (Cant. / Descripción / P. unit. / 10%) are pre-printed; only row data drawn.
    List<DetailRow> detailRows = buildDetailRows(invoice);
    BigDecimal[] colSubtotals = {BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO};
    for (DetailRow dr : detailRows) {
      for (int c = 0; c < 3; c++) {
        if (dr.columnAmounts()[c] != null) {
          colSubtotals[c] = colSubtotals[c].add(dr.columnAmounts()[c]);
        }
      }
    }

    float yRow = TABLE_FIRST_ROW_Y;
    cb.setFontAndSize(bf, TABLE_PT);
    int rowsDrawn = 0;
    for (DetailRow dr : detailRows) {
      if (rowsDrawn >= MAX_ROWS) {
        break;
      }
      float yTop = yRow;
      cb.beginText();
      if (dr.quantity() != null) {
        cb.showTextAligned(Element.ALIGN_LEFT, String.valueOf(dr.quantity()), xQty, yTop, 0);
      }
      cb.showTextAligned(
          descAlign, truncate(dr.description(), dr.maxDescChars()), xDescAnchor, yTop, 0);
      if (dr.unitPrice() != null) {
        cb.showTextAligned(unitAlign, formatMoneyGs(dr.unitPrice()), xUnitAnchor, yTop, 0);
      }
      for (int c = 0; c < 3; c++) {
        BigDecimal amount = dr.columnAmounts()[c];
        if (amount != null) {
          float xTax = xTaxCol10 - (2 - c) * TAX_COL_WIDTH_PT;
          cb.showTextAligned(Element.ALIGN_LEFT, formatSignedMoneyGs(amount), xTax, yTop, 0);
        }
      }
      cb.endText();
      yRow -= ROW_STEP_PT;
      rowsDrawn++;
    }

    // --- Subtotals row ---
    cb.beginText();
    cb.setFontAndSize(bf, BODY_PT);
    for (int c = 0; c < 3; c++) {
      if (colSubtotals[c].compareTo(BigDecimal.ZERO) != 0) {
        float xTax = xSubtotalTax10 - (2 - c) * TAX_COL_WIDTH_PT;
        cb.showTextAligned(
            Element.ALIGN_LEFT, formatSignedMoneyGs(colSubtotals[c]), xTax, ySubtotals, 0);
      }
    }

    // --- IVA liquidation row ---
    // Issue #102: each column's IVA is computed from colSubtotals — the column's FINAL total,
    // net of every discount (item-level and global) — not from a pre-global-discount snapshot.
    cb.setFontAndSize(bf, BODY_PT);
    BigDecimal iva10 = computeIvaByRate(invoice, colSubtotals[2], BigDecimal.valueOf(10));
    BigDecimal iva5 = computeIvaByRate(invoice, colSubtotals[1], BigDecimal.valueOf(5));
    cb.showTextAligned(Element.ALIGN_LEFT, formatMoneyGs(iva10), xIva10, yIva, 0);
    if (iva5.compareTo(BigDecimal.ZERO) > 0) {
      cb.showTextAligned(Element.ALIGN_LEFT, formatMoneyGs(iva5), xIva5, yIva, 0);
    }
    BigDecimal totalIva = iva5.add(iva10);
    cb.showTextAligned(Element.ALIGN_LEFT, formatMoneyGs(totalIva), xTotalIva, yIva, 0);
    cb.endText();

    // --- Amount in words ---
    cb.beginText();
    cb.setFontAndSize(bf, BODY_PT);
    cb.showTextAligned(
        Element.ALIGN_LEFT, SpanishNumberToWords.guaranies(invoice.getTotal()), xWords, yWords, 0);
    cb.endText();

    // HU-21: "COPIA: ARCHIVO TRIBUTARIO" / "ORIGINAL: ADQUIRENTE" labels not drawn;
    // the physical form already differentiates the two copies.
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

  /**
   * Issue #90: a detail row's printable description, truncated to {@link #DESC_MAX_CHARS_PER_LINE}
   * chars — it is never wrapped onto a second line.
   */
  static String truncatedDescription(String description) {
    return truncate(description, DESC_MAX_CHARS_PER_LINE);
  }

  /**
   * A single line printed in the detail table. {@code quantity}/{@code unitPrice} are non-null only
   * for item rows; {@code columnAmounts} holds the amount per tax column (index 0 = Exenta, 1 = IVA
   * 5 %, 2 = IVA 10 %), with {@code null} for empty columns and negative values for discounts.
   */
  record DetailRow(
      Integer quantity,
      String description,
      BigDecimal unitPrice,
      BigDecimal[] columnAmounts,
      int maxDescChars) {
    DetailRow(
        Integer quantity, String description, BigDecimal unitPrice, BigDecimal[] columnAmounts) {
      this(quantity, description, unitPrice, columnAmounts, DESC_MAX_CHARS_PER_LINE);
    }
  }

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
                // Issue #90: discount data printed before the item description (e.g. "Dto. 10%
                // PINTURA DE MANOS"), not after.
                lineDiscountDescription(line.getDiscountType(), line.getDiscountValue())
                    + " "
                    + lineDescriptionForPrint(line),
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
              globalDiscountDescription(invoice.getDiscountType(), invoice.getDiscountValue()),
              null,
              split,
              GLOBAL_DISCOUNT_DESC_MAX_CHARS));
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

  /** Issue #94: "Dto. global 10%" for PERCENT, "Dto. global Monto fijo" for FIXED. */
  private static String globalDiscountDescription(DiscountType type, BigDecimal value) {
    return switch (type) {
      case PERCENT ->
          "Dto. global " + (value != null ? value.stripTrailingZeros().toPlainString() : "0") + "%";
      case FIXED -> "Dto. global Monto fijo";
      case NONE -> "Dto. global";
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
   * Issue #102: IVA-incluido amount for a tax column, computed from {@code columnTotal} — that
   * column's FINAL total, net of every discount (item-level and global) — via total * rate / (100 +
   * rate). Falls back to the legacy total/11 formula for invoices that predate V11 (where taxAmount
   * is null on all lines), matching the historical 10%-only default.
   */
  private static BigDecimal computeIvaByRate(
      Invoice invoice, BigDecimal columnTotal, BigDecimal rate) {
    boolean hasTaxData =
        invoice.getLines() != null
            && invoice.getLines().stream().anyMatch(l -> l.getTaxAmount() != null);
    if (!hasTaxData) {
      if (rate.compareTo(BigDecimal.valueOf(10)) == 0) {
        return vatTenFromTotal(invoice.getTotal());
      }
      return BigDecimal.ZERO;
    }
    return ivaIncludedInTotal(columnTotal, rate);
  }

  /**
   * Paraguay IVA-incluido: IVA = total * rate / (100 + rate), rounded HALF_UP to 0 decimals. E.g.
   * rate=10 -> total/11; rate=5 -> total/21.
   */
  private static BigDecimal ivaIncludedInTotal(BigDecimal total, BigDecimal rate) {
    if (total == null || total.compareTo(BigDecimal.ZERO) <= 0) {
      return BigDecimal.ZERO;
    }
    return total.multiply(rate).divide(BigDecimal.valueOf(100).add(rate), 0, RoundingMode.HALF_UP);
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
