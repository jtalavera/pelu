package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.BusinessProfile;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.InvoiceLine;
import com.cursorpoc.backend.domain.InvoicePaymentAllocation;
import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.enums.DiscountType;
import com.cursorpoc.backend.domain.enums.InvoiceStatus;
import com.cursorpoc.backend.repository.BusinessProfileRepository;
import com.cursorpoc.backend.repository.InvoiceRepository;
import com.lowagie.text.Chunk;
import com.lowagie.text.Document;
import com.lowagie.text.DocumentException;
import com.lowagie.text.Element;
import com.lowagie.text.Font;
import com.lowagie.text.Image;
import com.lowagie.text.PageSize;
import com.lowagie.text.Paragraph;
import com.lowagie.text.Phrase;
import com.lowagie.text.Rectangle;
import com.lowagie.text.pdf.BaseFont;
import com.lowagie.text.pdf.PdfContentByte;
import com.lowagie.text.pdf.PdfGState;
import com.lowagie.text.pdf.PdfPCell;
import com.lowagie.text.pdf.PdfPTable;
import com.lowagie.text.pdf.PdfPageEventHelper;
import com.lowagie.text.pdf.PdfWriter;
import java.awt.Color;
import java.io.ByteArrayOutputStream;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import org.hibernate.Hibernate;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Comprobante NO fiscal: the printable receipt a business gets when SIFEN electronic invoicing is
 * not active. It replaces the old pre-printed continuous-form invoice. It looks like the KuDE
 * (header with the business logo, client block, detail, IVA breakdown, payments) but carries no
 * fiscal data (no timbrado, no CDC, no QR) and says on every page that it has no fiscal value.
 *
 * <p>Two formats, chosen at download time: A4 (like the KuDE) and a 80 mm ticket for thermal
 * printers. The number printed is the invoice's own number, which still comes from the fiscal
 * stamp's sequence ({@code 001-001-0000123}) so receipts stay distinguishable.
 */
@Service
public class NonFiscalReceiptPdfService {

  /** Feature flag of the receipt (part of the Estándar tier, like any other tier flag). */
  public static final String NON_FISCAL_RECEIPT_FLAG_KEY = "NON_FISCAL_RECEIPT";

  /** Same key as {@code InvoiceController}'s: once SIFEN is active the KuDE replaces this. */
  private static final String SIFEN_ELECTRONIC_INVOICING_FLAG_KEY = "SIFEN_ELECTRONIC_INVOICING";

  public enum Format {
    A4,
    TICKET;

    /** Parses the {@code format} query parameter; blank means A4. */
    public static Format parse(String raw) {
      if (raw == null || raw.isBlank()) {
        return A4;
      }
      try {
        return valueOf(raw.trim().toUpperCase(Locale.ROOT));
      } catch (IllegalArgumentException e) {
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "RECEIPT_FORMAT_INVALID");
      }
    }
  }

  /** Result of building a receipt: the rendered bytes and the proposed download filename. */
  public record ReceiptResult(byte[] bytes, String filename) {}

  static final String TITLE = "COMPROBANTE NO FISCAL";
  static final String BANNER = "DOCUMENTO SIN VALOR FISCAL · NO ES UNA FACTURA";
  static final String WATERMARK = "SIN VALOR FISCAL";
  static final String DISCLAIMER =
      "Este comprobante es un documento interno de control. No reemplaza a la factura legal ni"
          + " tiene validez fiscal.";

  private static final float TICKET_WIDTH_PT = 226.77f; // 80 mm
  private static final float TICKET_MARGIN_PT = 10f;
  private static final Color INK = new Color(0x1A, 0x23, 0x26);
  private static final Color MUTED = new Color(0x56, 0x63, 0x68);
  private static final Color LINE = new Color(0xD9, 0xD4, 0xCB);
  private static final Color BANNER_BG = new Color(0xFB, 0xF1, 0xE1);
  private static final Color BANNER_FG = new Color(0x5A, 0x3D, 0x0F);

  private final InvoiceRepository invoiceRepository;
  private final BusinessProfileRepository businessProfileRepository;
  private final FemmeTimeProperties timeProperties;
  private final FeatureFlagService featureFlagService;

  public NonFiscalReceiptPdfService(
      InvoiceRepository invoiceRepository,
      BusinessProfileRepository businessProfileRepository,
      FemmeTimeProperties timeProperties,
      FeatureFlagService featureFlagService) {
    this.invoiceRepository = invoiceRepository;
    this.businessProfileRepository = businessProfileRepository;
    this.timeProperties = timeProperties;
    this.featureFlagService = featureFlagService;
  }

  @Transactional(readOnly = true)
  public ReceiptResult buildReceipt(long invoiceId, long tenantId, Format format) {
    if (featureFlagService.isEnabled(SIFEN_ELECTRONIC_INVOICING_FLAG_KEY, tenantId)) {
      // With SIFEN active the only printable document is the KuDE.
      throw new ResponseStatusException(HttpStatus.CONFLICT, "SIFEN_LEGACY_PDF_DISABLED");
    }
    if (!featureFlagService.isEnabled(NON_FISCAL_RECEIPT_FLAG_KEY, tenantId)) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "NON_FISCAL_RECEIPT_NOT_ENABLED");
    }
    Invoice invoice =
        invoiceRepository
            .findByIdAndTenant_Id(invoiceId, tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "INVOICE_NOT_FOUND"));
    if (invoice.getStatus() != InvoiceStatus.ISSUED) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVOICE_PDF_ONLY_FOR_ISSUED");
    }
    Hibernate.initialize(invoice.getLines());
    Hibernate.initialize(invoice.getPaymentAllocations());
    if (invoice.getClient() != null) {
      Hibernate.initialize(invoice.getClient());
    }
    for (InvoiceLine line : invoice.getLines()) {
      Hibernate.initialize(line.getSalonService());
      Hibernate.initialize(line.getProfessional());
    }
    BusinessProfile profile = businessProfileRepository.findByTenantId(tenantId).orElse(null);
    String tenantName = invoice.getTenant() != null ? invoice.getTenant().getName() : null;
    byte[] bytes = render(invoice, profile, tenantName, format);
    return new ReceiptResult(bytes, buildFilename(invoice, format));
  }

  /**
   * {@code COMPROBANTE-NO-FISCAL-<yyyymmdd>-<001-001-0000123>.pdf} (suffix {@code -TICKET} for the
   * 80 mm format). The date is the emission date in the business zone, like the number on paper.
   */
  String buildFilename(Invoice invoice, Format format) {
    String date =
        DateTimeFormatter.ofPattern("yyyyMMdd")
            .withZone(timeProperties.zoneId())
            .format(invoice.getIssuedAt());
    return "COMPROBANTE-NO-FISCAL-"
        + date
        + "-"
        + formattedNumber(invoice)
        + (format == Format.TICKET ? "-TICKET" : "")
        + ".pdf";
  }

  /** {@code 001-001-0000123}: establishment, expedition point and the stamp-sequence number. */
  static String formattedNumber(Invoice invoice) {
    int est = invoice.getFiscalStamp() != null ? invoice.getFiscalStamp().getEstablishment() : 1;
    int pe = invoice.getFiscalStamp() != null ? invoice.getFiscalStamp().getExpeditionPoint() : 1;
    return String.format("%03d-%03d-%07d", est, pe, invoice.getInvoiceNumber());
  }

  byte[] render(Invoice invoice, BusinessProfile profile, String tenantName, Format format) {
    Receipt receipt = Receipt.of(invoice, profile, tenantName, timeProperties);
    try {
      return format == Format.TICKET ? renderTicket(receipt) : renderA4(receipt);
    } catch (DocumentException e) {
      throw new IllegalStateException("Failed to build the non-fiscal receipt PDF", e);
    }
  }

  // ── Data ────────────────────────────────────────────────────────────────────

  /** Everything the two layouts print, computed once from the invoice. */
  record Receipt(
      String businessName,
      String ruc,
      String address,
      String phone,
      String email,
      String logoDataUrl,
      String footerMessage,
      String number,
      String date,
      String clientName,
      String clientDocument,
      String attendedBy,
      List<DetailRow> rows,
      BigDecimal[] columnSubtotals,
      BigDecimal total,
      BigDecimal subtotal,
      BigDecimal discount,
      BigDecimal iva5,
      BigDecimal iva10,
      List<String[]> payments,
      BigDecimal tips) {

    static Receipt of(
        Invoice invoice,
        BusinessProfile profile,
        String tenantName,
        FemmeTimeProperties timeProperties) {
      String name = profile != null ? clean(profile.getBusinessName()) : null;
      if (name == null) {
        name = tenantName != null ? tenantName : "";
      }
      DateTimeFormatter dateFmt =
          DateTimeFormatter.ofPattern("dd/MM/yyyy HH:mm")
              .withZone(timeProperties.zoneId())
              .withLocale(Locale.forLanguageTag("es-PY"));

      // Same privacy rule as the old printed invoice (issues #96/#101): the receipt prints only
      // what was
      // written on the invoice. A registered client whose name was cleared shows as «Sin nombre»,
      // and
      // her own RUC / C.I. never leaks in.
      String clientName = clean(invoice.getClientDisplayName());
      if (clientName == null) {
        clientName = invoice.getClient() != null ? "Sin nombre" : "Cliente ocasional";
      }
      String document = clean(invoice.getClientRucOverride());
      if (document == null) {
        document = clean(invoice.getClientIdentityDocumentOverride());
      }

      Set<String> professionals = new LinkedHashSet<>();
      for (InvoiceLine line : invoice.getLines()) {
        Professional p = line.getProfessional();
        if (p != null && clean(p.getDisplayName()) != null) {
          professionals.add(p.getDisplayName().trim());
        }
      }

      List<DetailRow> rows = buildDetailRows(invoice);
      BigDecimal[] sums = {BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO};
      for (DetailRow r : rows) {
        for (int c = 0; c < 3; c++) {
          if (r.columnAmounts()[c] != null) {
            sums[c] = sums[c].add(r.columnAmounts()[c]);
          }
        }
      }
      BigDecimal total = invoice.getTotal() != null ? invoice.getTotal() : BigDecimal.ZERO;
      BigDecimal subtotal = invoice.getSubtotal() != null ? invoice.getSubtotal() : total;
      BigDecimal discount = subtotal.subtract(total);

      boolean hasTaxData = invoice.getLines().stream().anyMatch(l -> l.getTaxAmount() != null);
      BigDecimal iva10 =
          hasTaxData
              ? ivaIncludedInTotal(sums[2], BigDecimal.TEN)
              : ivaIncludedInTotal(total, BigDecimal.TEN);
      BigDecimal iva5 =
          hasTaxData ? ivaIncludedInTotal(sums[1], BigDecimal.valueOf(5)) : BigDecimal.ZERO;

      List<String[]> payments = new ArrayList<>();
      for (InvoicePaymentAllocation a : invoice.getPaymentAllocations()) {
        payments.add(new String[] {paymentLabel(a), formatMoney(a.getAmount())});
      }

      return new Receipt(
          name,
          profile != null ? clean(profile.getRuc()) : null,
          profile != null ? clean(profile.getAddress()) : null,
          profile != null ? clean(profile.getPhone()) : null,
          profile != null ? clean(profile.getContactEmail()) : null,
          profile != null ? profile.getLogoDataUrl() : null,
          profile != null ? clean(profile.getKudeFooterMessage()) : null,
          formattedNumber(invoice),
          dateFmt.format(invoice.getIssuedAt()),
          clientName,
          document,
          professionals.isEmpty() ? null : String.join(", ", professionals),
          rows,
          sums,
          total,
          subtotal,
          discount,
          iva5,
          iva10,
          payments,
          invoice.getTipsAmount());
    }
  }

  private static String paymentLabel(InvoicePaymentAllocation a) {
    String base =
        switch (a.getMethod()) {
          case CASH -> "Efectivo";
          case DEBIT_CARD -> "Tarjeta de débito";
          case CREDIT_CARD -> "Tarjeta de crédito";
          case TRANSFER -> "Transferencia";
          case OTHER -> "Otro";
        };
    String brand = null;
    if (a.getCardBrand() != null) {
      brand =
          a.getCardBrand().sifenDescription() != null
              ? a.getCardBrand().sifenDescription()
              : clean(a.getCardBrandOtherDescription());
    }
    return brand != null ? base + " · " + brand : base;
  }

  // ── Detail rows & IVA (same rules the old printed invoice used) ─────────────

  /** One printed line: {@code columnAmounts} = Exentas / IVA 5% / IVA 10%. */
  record DetailRow(
      Integer quantity, String description, BigDecimal unitPrice, BigDecimal[] columnAmounts) {}

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

  static String lineDescriptionForPrint(InvoiceLine line) {
    if (line.getSalonService() != null && line.getSalonService().getName() != null) {
      return line.getSalonService().getName().trim();
    }
    return line.getDescription() != null ? line.getDescription().trim() : "";
  }

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
                lineDiscountDescription(line.getDiscountType(), line.getDiscountValue())
                    + " "
                    + lineDescriptionForPrint(line),
                null,
                discAmounts));
      }
    }

    BigDecimal globalDiscount =
        invoice.getSubtotal() != null && invoice.getTotal() != null
            ? invoice.getSubtotal().subtract(invoice.getTotal())
            : BigDecimal.ZERO;
    if (invoice.getDiscountType() != null
        && invoice.getDiscountType() != DiscountType.NONE
        && globalDiscount.compareTo(BigDecimal.ZERO) > 0) {
      rows.add(
          new DetailRow(
              null,
              globalDiscountDescription(invoice.getDiscountType(), invoice.getDiscountValue()),
              null,
              distributeGlobalDiscount(globalDiscount, netByColumn)));
    }
    return rows;
  }

  private static String lineDiscountDescription(DiscountType type, BigDecimal value) {
    if (value == null) {
      return "Dto.";
    }
    return switch (type) {
      case PERCENT -> "Dto. " + value.stripTrailingZeros().toPlainString() + "%";
      case FIXED -> "Dto. " + formatMoney(value) + " Gs.";
      case NONE -> "Dto.";
    };
  }

  private static String globalDiscountDescription(DiscountType type, BigDecimal value) {
    return switch (type) {
      case PERCENT ->
          "Dto. global " + (value != null ? value.stripTrailingZeros().toPlainString() : "0") + "%";
      case FIXED -> "Dto. global Monto fijo";
      case NONE -> "Dto. global";
    };
  }

  /** Splits a global discount across the tax columns in proportion to each column's net amount. */
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

  /** IVA contained in a tax-included amount: {@code amount × rate / (100 + rate)}. */
  static BigDecimal ivaIncludedInTotal(BigDecimal amount, BigDecimal rate) {
    if (amount == null || amount.compareTo(BigDecimal.ZERO) <= 0) {
      return BigDecimal.ZERO;
    }
    return amount.multiply(rate).divide(BigDecimal.valueOf(100).add(rate), 0, RoundingMode.HALF_UP);
  }

  // ── A4 ──────────────────────────────────────────────────────────────────────

  private byte[] renderA4(Receipt r) throws DocumentException {
    Document document = new Document(PageSize.A4, 36, 36, 36, 36);
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    PdfWriter writer = PdfWriter.getInstance(document, out);
    writer.setPageEvent(new WatermarkEvent());
    document.open();

    Font title = font(Font.HELVETICA, 17, Font.BOLD, INK);
    Font bold = font(Font.HELVETICA, 9.5f, Font.BOLD, INK);
    Font body = font(Font.HELVETICA, 9.5f, Font.NORMAL, INK);
    Font small = font(Font.HELVETICA, 8f, Font.NORMAL, MUTED);
    Font label = font(Font.HELVETICA, 8.5f, Font.NORMAL, MUTED);

    // Header: logo | business | receipt box (the logo column only exists when there is a logo).
    Image logo = logoImage(r.logoDataUrl(), 92, 80);
    PdfPTable header = new PdfPTable(logo != null ? 3 : 2);
    header.setWidthPercentage(100);
    header.setWidths(logo != null ? new float[] {22, 48, 30} : new float[] {68, 32});
    if (logo != null) {
      PdfPCell logoCell = new PdfPCell(logo, false);
      logoCell.setBorder(Rectangle.NO_BORDER);
      logoCell.setHorizontalAlignment(Element.ALIGN_LEFT);
      logoCell.setVerticalAlignment(Element.ALIGN_TOP);
      logoCell.setPaddingRight(8);
      header.addCell(logoCell);
    }
    Paragraph biz = new Paragraph();
    addLine(biz, r.businessName(), logo != null ? title : font(Font.HELVETICA, 21, Font.BOLD, INK));
    if (r.ruc() != null) {
      addLine(biz, "RUC " + r.ruc(), small);
    }
    if (r.address() != null) {
      addLine(biz, r.address(), small);
    }
    if (r.phone() != null) {
      addLine(biz, "Tel. " + r.phone(), small);
    }
    if (r.email() != null) {
      addLine(biz, r.email(), small);
    }
    PdfPCell bizCell = new PdfPCell();
    bizCell.setBorder(Rectangle.NO_BORDER);
    bizCell.addElement(biz);
    header.addCell(bizCell);

    PdfPTable box = new PdfPTable(1);
    box.setWidthPercentage(100);
    PdfPCell boxCell = new PdfPCell();
    boxCell.setBorderWidth(1.4f);
    boxCell.setBorderColor(INK);
    boxCell.setPadding(7);
    boxCell.setHorizontalAlignment(Element.ALIGN_CENTER);
    Paragraph tag = new Paragraph();
    tag.setAlignment(Element.ALIGN_CENTER);
    addLine(tag, "COMPROBANTE", font(Font.HELVETICA, 11, Font.BOLD, INK));
    addLine(tag, "NO FISCAL", font(Font.HELVETICA, 9, Font.NORMAL, MUTED));
    tag.add(new Chunk("N.º " + r.number(), font(Font.HELVETICA, 13, Font.BOLD, INK)));
    boxCell.addElement(tag);
    box.addCell(boxCell);
    PdfPCell boxHolder = new PdfPCell(box);
    boxHolder.setBorder(Rectangle.NO_BORDER);
    header.addCell(boxHolder);
    document.add(header);
    document.add(rule(1.6f));

    // Banner
    PdfPTable banner = new PdfPTable(1);
    banner.setWidthPercentage(100);
    banner.setSpacingBefore(8);
    banner.setSpacingAfter(8);
    PdfPCell bannerCell =
        new PdfPCell(new Phrase(BANNER, font(Font.HELVETICA, 9, Font.BOLD, BANNER_FG)));
    bannerCell.setBackgroundColor(BANNER_BG);
    bannerCell.setBorderColor(new Color(0xD8, 0xB8, 0x78));
    bannerCell.setHorizontalAlignment(Element.ALIGN_CENTER);
    bannerCell.setPadding(6);
    banner.addCell(bannerCell);
    document.add(banner);

    // Sale + client block
    PdfPTable info = new PdfPTable(4);
    info.setWidthPercentage(100);
    info.setWidths(new float[] {13, 37, 13, 37});
    addInfo(info, "Fecha", r.date(), label, body);
    addInfo(info, "Condición", "Contado", label, body);
    addInfo(info, "Cliente", r.clientName(), label, body);
    addInfo(info, "RUC / C.I.", r.clientDocument() != null ? r.clientDocument() : "—", label, body);
    if (r.attendedBy() != null) {
      addInfo(info, "Atendió", r.attendedBy(), label, body);
      addInfo(info, "", "", label, body);
    }
    info.setSpacingAfter(6);
    document.add(info);

    // Detail: Cant | Descripción | Precio unit. | Exentas | IVA 5% | IVA 10%
    PdfPTable items = new PdfPTable(6);
    items.setWidthPercentage(100);
    items.setWidths(new float[] {7, 37, 15, 14, 13, 14});
    items.setHeaderRows(1);
    String[] heads = {"Cant.", "Descripción", "Precio unit.", "Exentas", "IVA 5%", "IVA 10%"};
    for (int i = 0; i < heads.length; i++) {
      PdfPCell h = new PdfPCell(new Phrase(heads[i], font(Font.HELVETICA, 8, Font.BOLD, MUTED)));
      h.setBorder(Rectangle.BOTTOM);
      h.setBorderWidth(1.2f);
      h.setBorderColor(INK);
      h.setHorizontalAlignment(i < 2 ? Element.ALIGN_LEFT : Element.ALIGN_RIGHT);
      h.setPadding(3);
      items.addCell(h);
    }
    for (DetailRow row : r.rows()) {
      addItemCell(
          items,
          row.quantity() != null ? String.valueOf(row.quantity()) : "",
          body,
          Element.ALIGN_LEFT);
      addItemCell(items, row.description(), body, Element.ALIGN_LEFT);
      addItemCell(
          items,
          row.unitPrice() != null ? formatMoney(row.unitPrice()) : "",
          body,
          Element.ALIGN_RIGHT);
      for (int c = 0; c < 3; c++) {
        BigDecimal v = row.columnAmounts()[c];
        addItemCell(items, v != null ? formatSigned(v) : "", body, Element.ALIGN_RIGHT);
      }
    }
    document.add(items);

    // Totals
    PdfPTable totals = new PdfPTable(2);
    totals.setWidthPercentage(52);
    totals.setHorizontalAlignment(Element.ALIGN_RIGHT);
    totals.setSpacingBefore(8);
    addTotalRow(totals, "Subtotal", formatMoney(r.subtotal()), body, body);
    if (r.discount().compareTo(BigDecimal.ZERO) > 0) {
      addTotalRow(totals, "Descuento", "- " + formatMoney(r.discount()), body, body);
    }
    PdfPCell tl =
        totalCell("TOTAL Gs.", font(Font.HELVETICA, 12, Font.BOLD, INK), Element.ALIGN_LEFT);
    PdfPCell tv =
        totalCell(
            formatMoney(r.total()), font(Font.HELVETICA, 12, Font.BOLD, INK), Element.ALIGN_RIGHT);
    tl.setBorder(Rectangle.TOP);
    tv.setBorder(Rectangle.TOP);
    tl.setBorderWidth(1.2f);
    tv.setBorderWidth(1.2f);
    totals.addCell(tl);
    totals.addCell(tv);
    document.add(totals);

    Paragraph words = new Paragraph("Son: " + SpanishNumberToWords.guaranies(r.total()), small);
    words.setAlignment(Element.ALIGN_RIGHT);
    words.setSpacingBefore(3);
    document.add(words);

    // IVA breakdown
    Paragraph ivaTitle =
        new Paragraph(
            "Liquidación del IVA (incluido en el total)",
            font(Font.HELVETICA, 8, Font.BOLD, MUTED));
    ivaTitle.setSpacingBefore(10);
    ivaTitle.setSpacingAfter(2);
    document.add(ivaTitle);
    PdfPTable iva = new PdfPTable(3);
    iva.setWidthPercentage(100);
    iva.setWidths(new float[] {34, 33, 33});
    addIva(iva, "IVA 5%", r.iva5(), small, bold);
    addIva(iva, "IVA 10%", r.iva10(), small, bold);
    addIva(iva, "Total IVA", r.iva5().add(r.iva10()), small, bold);
    document.add(iva);

    // Payment
    if (!r.payments().isEmpty()) {
      Paragraph pay = new Paragraph("Forma de pago", bold);
      pay.setSpacingBefore(10);
      document.add(pay);
      PdfPTable pt = new PdfPTable(2);
      pt.setWidthPercentage(60);
      pt.setHorizontalAlignment(Element.ALIGN_LEFT);
      for (String[] p : r.payments()) {
        PdfPCell a = new PdfPCell(new Phrase(p[0], body));
        a.setBorder(Rectangle.NO_BORDER);
        PdfPCell b = new PdfPCell(new Phrase(p[1], body));
        b.setBorder(Rectangle.NO_BORDER);
        b.setHorizontalAlignment(Element.ALIGN_RIGHT);
        pt.addCell(a);
        pt.addCell(b);
      }
      document.add(pt);
    }
    if (r.tips() != null && r.tips().compareTo(BigDecimal.ZERO) > 0) {
      document.add(
          new Paragraph("Propina (no incluida en el total): " + formatMoney(r.tips()), small));
    }

    // Footer
    document.add(rule(1.6f));
    if (r.footerMessage() != null) {
      Paragraph msg = new Paragraph(r.footerMessage(), bold);
      msg.setAlignment(Element.ALIGN_CENTER);
      msg.setSpacingBefore(6);
      document.add(msg);
    }
    Paragraph disc = new Paragraph(DISCLAIMER, small);
    disc.setAlignment(Element.ALIGN_CENTER);
    disc.setSpacingBefore(4);
    document.add(disc);

    document.close();
    return out.toByteArray();
  }

  /** Light diagonal «SIN VALOR FISCAL» under the content of every page. */
  private static final class WatermarkEvent extends PdfPageEventHelper {
    @Override
    public void onEndPage(PdfWriter writer, Document document) {
      PdfContentByte cb = writer.getDirectContentUnder();
      try {
        BaseFont bf =
            BaseFont.createFont(BaseFont.HELVETICA_BOLD, BaseFont.CP1252, BaseFont.NOT_EMBEDDED);
        cb.saveState();
        PdfGState gs = new PdfGState();
        gs.setFillOpacity(0.09f);
        cb.setGState(gs);
        cb.beginText();
        cb.setFontAndSize(bf, 54);
        cb.setColorFill(new Color(0xA0, 0x6E, 0x28));
        cb.showTextAligned(
            Element.ALIGN_CENTER,
            WATERMARK,
            document.getPageSize().getWidth() / 2,
            document.getPageSize().getHeight() / 2,
            30);
        cb.endText();
        cb.restoreState();
      } catch (Exception ignored) {
        // The watermark is decoration; the banner and the title already say «no fiscal».
      }
    }
  }

  // ── Ticket 80 mm ────────────────────────────────────────────────────────────

  private byte[] renderTicket(Receipt r) throws DocumentException {
    // Thermal paper is continuous: render once on a tall page to measure the content, then again
    // on a page of exactly that height.
    float measured = ticketContentHeight(r);
    return drawTicket(r, measured, null);
  }

  private float ticketContentHeight(Receipt r) throws DocumentException {
    float[] used = new float[1];
    drawTicket(r, 4000f, used);
    // A little slack so the second pass never spills onto a second page.
    return Math.max(260f, used[0] + 2 * TICKET_MARGIN_PT + 12f);
  }

  private byte[] drawTicket(Receipt r, float pageHeight, float[] usedOut) throws DocumentException {
    Rectangle page = new Rectangle(TICKET_WIDTH_PT, pageHeight);
    Document document =
        new Document(page, TICKET_MARGIN_PT, TICKET_MARGIN_PT, TICKET_MARGIN_PT, TICKET_MARGIN_PT);
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    PdfWriter writer = PdfWriter.getInstance(document, out);
    document.open();

    Font bold = font(Font.COURIER, 8.5f, Font.BOLD, Color.BLACK);
    Font body = font(Font.COURIER, 8f, Font.NORMAL, Color.BLACK);
    Font big = font(Font.COURIER, 11f, Font.BOLD, Color.BLACK);

    Image logo = logoImage(r.logoDataUrl(), 70, 56);
    if (logo != null) {
      logo.setAlignment(Image.ALIGN_CENTER);
      logo.setSpacingAfter(4);
      document.add(logo);
    }
    Paragraph biz = new Paragraph();
    biz.setAlignment(Element.ALIGN_CENTER);
    addLine(biz, r.businessName().toUpperCase(Locale.ROOT), big);
    if (r.ruc() != null) {
      addLine(biz, "RUC " + r.ruc(), body);
    }
    if (r.address() != null) {
      addLine(biz, r.address(), body);
    }
    if (r.phone() != null) {
      addLine(biz, "Tel. " + r.phone(), body);
    }
    document.add(biz);

    PdfPTable tag = new PdfPTable(1);
    tag.setWidthPercentage(100);
    tag.setSpacingBefore(5);
    tag.setSpacingAfter(5);
    PdfPCell tagCell = new PdfPCell();
    tagCell.setBorderWidth(1.2f);
    tagCell.setPadding(4);
    Paragraph tp = new Paragraph();
    tp.setAlignment(Element.ALIGN_CENTER);
    addLine(tp, TITLE, bold);
    tp.add(new Chunk("SIN VALOR FISCAL", bold));
    tagCell.addElement(tp);
    tag.addCell(tagCell);
    document.add(tag);

    document.add(ticketPair("N.º", r.number(), body));
    document.add(ticketPair("Fecha", r.date(), body));
    document.add(ticketPair("Cliente", truncate(r.clientName(), 16), body));
    if (r.clientDocument() != null) {
      document.add(ticketPair("RUC/C.I.", r.clientDocument(), body));
    }
    if (r.attendedBy() != null) {
      document.add(ticketPair("Atendió", truncate(r.attendedBy(), 16), body));
    }
    document.add(dashed(body));

    for (DetailRow row : r.rows()) {
      BigDecimal amount = null;
      for (BigDecimal v : row.columnAmounts()) {
        if (v != null) {
          amount = v;
        }
      }
      String left =
          (row.quantity() != null ? row.quantity() + " " : "") + truncate(row.description(), 22);
      document.add(ticketPair(left, amount != null ? formatSigned(amount) : "", body));
    }
    document.add(dashed(body));

    if (r.discount().compareTo(BigDecimal.ZERO) > 0) {
      document.add(ticketPair("Subtotal", formatMoney(r.subtotal()), body));
      document.add(ticketPair("Descuento", "-" + formatMoney(r.discount()), body));
    }
    document.add(ticketPair("TOTAL Gs.", formatMoney(r.total()), big));
    Paragraph words = new Paragraph("Son: " + SpanishNumberToWords.guaranies(r.total()), body);
    words.setSpacingAfter(2);
    document.add(words);
    document.add(ticketPair("IVA 5%", formatMoney(r.iva5()), body));
    document.add(ticketPair("IVA 10%", formatMoney(r.iva10()), body));
    document.add(ticketPair("Total IVA", formatMoney(r.iva5().add(r.iva10())), body));
    document.add(dashed(body));

    for (String[] p : r.payments()) {
      document.add(ticketPair(truncate(p[0], 24), p[1], body));
    }
    if (r.tips() != null && r.tips().compareTo(BigDecimal.ZERO) > 0) {
      document.add(ticketPair("Propina*", formatMoney(r.tips()), body));
      document.add(
          new Paragraph(
              "*no incluida en el total", font(Font.COURIER, 7f, Font.NORMAL, Color.BLACK)));
    }
    document.add(dashed(body));

    if (r.footerMessage() != null) {
      Paragraph msg = new Paragraph(r.footerMessage(), bold);
      msg.setAlignment(Element.ALIGN_CENTER);
      document.add(msg);
    }
    Paragraph disc =
        new Paragraph(
            "Documento interno. No es factura ni tiene valor fiscal.",
            font(Font.COURIER, 7f, Font.NORMAL, Color.BLACK));
    disc.setAlignment(Element.ALIGN_CENTER);
    document.add(disc);

    if (usedOut != null) {
      usedOut[0] = pageHeight - writer.getVerticalPosition(true) - TICKET_MARGIN_PT;
    }
    document.close();
    return out.toByteArray();
  }

  private static PdfPTable ticketPair(String left, String right, Font font)
      throws DocumentException {
    PdfPTable t = new PdfPTable(2);
    t.setWidthPercentage(100);
    t.setWidths(new float[] {58, 42});
    PdfPCell a = new PdfPCell(new Phrase(left, font));
    a.setBorder(Rectangle.NO_BORDER);
    a.setPadding(0);
    PdfPCell b = new PdfPCell(new Phrase(right, font));
    b.setBorder(Rectangle.NO_BORDER);
    b.setPadding(0);
    b.setHorizontalAlignment(Element.ALIGN_RIGHT);
    t.addCell(a);
    t.addCell(b);
    return t;
  }

  private static Paragraph dashed(Font font) {
    Paragraph p = new Paragraph("-".repeat(34), font);
    p.setAlignment(Element.ALIGN_CENTER);
    return p;
  }

  // ── Small helpers ───────────────────────────────────────────────────────────

  /** Adds a line of text in its own font; the line break is a separate chunk so the font sticks. */
  private static void addLine(Paragraph p, String text, Font font) {
    p.add(new Chunk(text, font));
    p.add(Chunk.NEWLINE);
  }

  private static Font font(int family, float size, int style, Color color) {
    return new Font(family, size, style, color);
  }

  private static PdfPTable rule(float width) {
    PdfPTable t = new PdfPTable(1);
    t.setWidthPercentage(100);
    t.setSpacingBefore(4);
    PdfPCell c = new PdfPCell(new Phrase(" ", font(Font.HELVETICA, 1, Font.NORMAL, INK)));
    c.setBorder(Rectangle.TOP);
    c.setBorderWidth(width);
    c.setBorderColor(INK);
    c.setFixedHeight(2);
    t.addCell(c);
    return t;
  }

  private static void addInfo(
      PdfPTable t, String label, String value, Font labelFont, Font valueFont) {
    PdfPCell l = new PdfPCell(new Phrase(label, labelFont));
    l.setBorder(Rectangle.NO_BORDER);
    l.setPaddingBottom(2);
    PdfPCell v = new PdfPCell(new Phrase(value, valueFont));
    v.setBorder(Rectangle.NO_BORDER);
    v.setPaddingBottom(2);
    t.addCell(l);
    t.addCell(v);
  }

  private static void addItemCell(PdfPTable t, String text, Font font, int align) {
    PdfPCell c = new PdfPCell(new Phrase(text, font));
    c.setBorder(Rectangle.BOTTOM);
    c.setBorderColor(LINE);
    c.setHorizontalAlignment(align);
    c.setPadding(3);
    t.addCell(c);
  }

  private static void addTotalRow(PdfPTable t, String label, String value, Font l, Font v) {
    t.addCell(totalCell(label, l, Element.ALIGN_LEFT));
    t.addCell(totalCell(value, v, Element.ALIGN_RIGHT));
  }

  private static PdfPCell totalCell(String text, Font font, int align) {
    PdfPCell c = new PdfPCell(new Phrase(text, font));
    c.setBorder(Rectangle.NO_BORDER);
    c.setHorizontalAlignment(align);
    c.setPadding(2);
    return c;
  }

  private static void addIva(
      PdfPTable t, String label, BigDecimal value, Font labelFont, Font valueFont) {
    Paragraph p = new Paragraph();
    p.add(new Chunk(label + ": ", labelFont));
    p.add(new Chunk(formatMoney(value), valueFont));
    PdfPCell c = new PdfPCell(p);
    c.setBorder(Rectangle.NO_BORDER);
    c.setPadding(1);
    t.addCell(c);
  }

  private static Image logoImage(String logoDataUrl, float maxWidth, float maxHeight) {
    if (logoDataUrl == null || !logoDataUrl.startsWith("data:image/")) {
      return null;
    }
    try {
      String base64 = logoDataUrl.substring(logoDataUrl.indexOf(',') + 1);
      Image image = Image.getInstance(Base64.getDecoder().decode(base64));
      image.scaleToFit(maxWidth, maxHeight);
      return image;
    } catch (Exception e) {
      // The logo is optional and must never block the receipt.
      return null;
    }
  }

  private static String clean(String s) {
    return s == null || s.isBlank() ? null : s.trim();
  }

  private static String truncate(String s, int max) {
    if (s == null) {
      return "";
    }
    return s.length() <= max ? s : s.substring(0, Math.max(0, max - 1)) + "…";
  }

  static String formatMoney(BigDecimal v) {
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

  private static String formatSigned(BigDecimal v) {
    return v.compareTo(BigDecimal.ZERO) < 0 ? "-" + formatMoney(v.abs()) : formatMoney(v);
  }
}
