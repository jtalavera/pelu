package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.BusinessProfile;
import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.enums.SifenSubmissionStatus;
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
import com.lowagie.text.pdf.PdfPCell;
import com.lowagie.text.pdf.PdfPTable;
import com.lowagie.text.pdf.PdfPageEventHelper;
import com.lowagie.text.pdf.PdfTemplate;
import com.lowagie.text.pdf.PdfWriter;
import java.io.ByteArrayOutputStream;
import java.math.BigDecimal;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Base64;
import java.util.Locale;
import org.hibernate.Hibernate;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * SIFEN HU-08: renders the KuDE (Kuatia Ryepy Vore, "Representación Gráfica del Documento
 * Electrónico") — a PDF visual representation of an already-approved invoice. Deliberately does
 * <b>not</b> recompute or reinterpret any figure: every value printed comes straight from {@link
 * SifenInvoiceHeaderService}/{@link SifenInvoiceDetailService} (the exact same data HU-02/HU-03
 * assembled for the signed DE) or from the invoice's own persisted SIFEN fields — AC-11 forbids any
 * other source, with two explicit exceptions (the business's optional logo and an optional free
 * message, both from {@link BusinessProfile}, never sent to SIFEN).
 *
 * <p>The QR URL/hash is <b>not</b> recomputed here — it's read from {@link
 * Invoice#getSifenQrUrl()}, persisted once by {@link SifenInvoiceSubmissionService} at the moment
 * the document was actually signed and sent (see that service's {@code persistQrData}). This keeps
 * KuDE generation independent of certificate validity at download time (a certificate can expire
 * long after an invoice was approved, but its KuDE must still be downloadable) and guarantees the
 * printed QR is bit-for-bit what SIFEN itself received, never a re-derived approximation.
 */
@Service
public class SifenKudePdfService {

  /** AC-13: minimum 25mm, of which zxing's own quiet zone covers the "3mm margen seguro" part. */
  static final float QR_WIDTH_POINTS = 30f * (72f / 25.4f);

  private static final int QR_PIXELS = 300;

  private static final DateTimeFormatter DATE_FORMAT =
      DateTimeFormatter.ofPattern("dd/MM/yyyy").withLocale(Locale.forLanguageTag("es-PY"));
  private static final DateTimeFormatter DATE_TIME_FORMAT =
      DateTimeFormatter.ofPattern("dd/MM/yyyy HH:mm").withLocale(Locale.forLanguageTag("es-PY"));

  private final InvoiceRepository invoiceRepository;
  private final BusinessProfileRepository businessProfileRepository;
  private final SifenInvoiceHeaderService headerService;
  private final SifenInvoiceDetailService detailService;
  private final SifenQrImageService qrImageService;
  private final FemmeTimeProperties timeProperties;

  public SifenKudePdfService(
      InvoiceRepository invoiceRepository,
      BusinessProfileRepository businessProfileRepository,
      SifenInvoiceHeaderService headerService,
      SifenInvoiceDetailService detailService,
      SifenQrImageService qrImageService,
      FemmeTimeProperties timeProperties) {
    this.invoiceRepository = invoiceRepository;
    this.businessProfileRepository = businessProfileRepository;
    this.headerService = headerService;
    this.detailService = detailService;
    this.qrImageService = qrImageService;
    this.timeProperties = timeProperties;
  }

  public record KudePdfResult(byte[] bytes, String filename) {}

  /** AC-01: only invoices SIFEN itself returned Aprobado/Aprobado con observación for. */
  @Transactional(readOnly = true)
  public KudePdfResult buildKudePdf(long tenantId, long invoiceId) {
    Invoice invoice = requireApprovedInvoice(tenantId, invoiceId);
    SifenInvoiceHeader header = headerService.buildHeader(tenantId, invoiceId);
    SifenInvoiceDetail detail = detailService.buildDetail(tenantId, invoiceId);
    BusinessProfile profile = businessProfileRepository.findByTenantId(tenantId).orElse(null);

    byte[] pdf = render(invoice, header, detail, profile);
    return new KudePdfResult(pdf, buildFilename(header, invoice));
  }

  @Transactional(readOnly = true)
  Invoice requireApprovedInvoice(long tenantId, long invoiceId) {
    Invoice invoice =
        invoiceRepository
            .findByIdAndTenant_Id(invoiceId, tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "INVOICE_NOT_FOUND"));
    SifenSubmissionStatus status = invoice.getSifenSubmissionStatus();
    if (status != SifenSubmissionStatus.APPROVED
        && status != SifenSubmissionStatus.APPROVED_WITH_OBSERVATION) {
      throw new ResponseStatusException(
          HttpStatus.CONFLICT, "SIFEN_KUDE_ONLY_FOR_APPROVED_INVOICES");
    }
    if (invoice.getSifenQrUrl() == null || invoice.getSifenQrUrl().isBlank()) {
      // Defensive only: every invoice that reached APPROVED went through submit(), which always
      // persists this first — should be unreachable in practice.
      throw new ResponseStatusException(HttpStatus.CONFLICT, "SIFEN_KUDE_MISSING_QR_DATA");
    }
    if (invoice.getClient() != null) {
      Hibernate.initialize(invoice.getClient());
    }
    return invoice;
  }

  String buildFilename(SifenInvoiceHeader header, Invoice invoice) {
    DateTimeFormatter fileDateFmt =
        DateTimeFormatter.ofPattern("yyyyMMdd").withZone(timeProperties.zoneId());
    String date = fileDateFmt.format(invoice.getIssuedAt());
    return "KUDE-"
        + date
        + "-"
        + header.stampNumber()
        + "-"
        + formattedInvoiceNumber(invoice)
        + ".pdf";
  }

  private static String formattedInvoiceNumber(Invoice invoice) {
    return String.format("%07d", invoice.getInvoiceNumber());
  }

  byte[] render(
      Invoice invoice,
      SifenInvoiceHeader header,
      SifenInvoiceDetail detail,
      BusinessProfile profile) {
    try {
      Document document = new Document(PageSize.A4, 36, 36, 36, 50);
      ByteArrayOutputStream baos = new ByteArrayOutputStream();
      PdfWriter writer = PdfWriter.getInstance(document, baos);
      PageNumberEvent pageEvent = new PageNumberEvent();
      writer.setPageEvent(pageEvent);
      document.open();

      Font titleFont = new Font(Font.HELVETICA, 13, Font.BOLD);
      Font subtitleFont = new Font(Font.HELVETICA, 10, Font.ITALIC);
      Font labelFont = new Font(Font.HELVETICA, 9, Font.BOLD);
      Font bodyFont = new Font(Font.HELVETICA, 9);
      Font legendFont = new Font(Font.HELVETICA, 8, Font.ITALIC);
      Font testLegendFont = new Font(Font.HELVETICA, 9, Font.BOLD, java.awt.Color.RED);

      addHeaderBlock(document, header, profile, titleFont, subtitleFont, bodyFont);
      addTimbradoAndSaleBlock(document, invoice, header, labelFont, bodyFont);
      if (isReceiverIdentified(header)) {
        addClientBlock(document, invoice, header, labelFont, bodyFont);
      }
      addQrAndControlNumberBlock(
          document, invoice, header, bodyFont, labelFont, legendFont, testLegendFont);
      addItemsTable(document, detail, labelFont, bodyFont);
      addTotalsBlock(document, detail.totals(), labelFont, bodyFont);
      addOptionalMessage(document, profile, bodyFont);

      document.close();
      return baos.toByteArray();
    } catch (DocumentException e) {
      throw new IllegalStateException("Failed to build KuDE PDF", e);
    }
  }

  private void addHeaderBlock(
      Document document,
      SifenInvoiceHeader header,
      BusinessProfile profile,
      Font titleFont,
      Font subtitleFont,
      Font bodyFont)
      throws DocumentException {
    SifenIssuerData issuer = header.issuer();
    String logoDataUrl = profile != null ? profile.getLogoDataUrl() : null;

    Paragraph businessInfo = new Paragraph();
    businessInfo.add(new Chunk(issuer.businessName() + "\n", titleFont));
    if (issuer.fantasyName() != null && !issuer.fantasyName().isBlank()) {
      businessInfo.add(new Chunk(issuer.fantasyName() + "\n", subtitleFont));
    }
    if (issuer.economicActivityDescription() != null) {
      businessInfo.add(new Chunk(issuer.economicActivityDescription() + "\n", bodyFont));
    }
    if (issuer.address() != null) {
      businessInfo.add(new Chunk(issuer.address() + "\n", bodyFont));
    }
    String city = joinNonBlank(", ", issuer.cityName(), issuer.departmentName());
    if (!city.isBlank()) {
      businessInfo.add(new Chunk(city, bodyFont));
    }

    if (logoDataUrl != null && logoDataUrl.startsWith("data:image/")) {
      PdfPTable table = new PdfPTable(2);
      table.setWidthPercentage(100);
      table.setWidths(new float[] {1f, 3f});
      PdfPCell logoCell = new PdfPCell(logoImage(logoDataUrl), true);
      logoCell.setBorder(0);
      PdfPCell textCell = new PdfPCell();
      textCell.setBorder(0);
      textCell.addElement(businessInfo);
      table.addCell(logoCell);
      table.addCell(textCell);
      document.add(table);
    } else {
      document.add(businessInfo);
    }
  }

  private Image logoImage(String logoDataUrl) {
    try {
      String base64 = logoDataUrl.substring(logoDataUrl.indexOf(',') + 1);
      byte[] bytes = Base64.getDecoder().decode(base64);
      Image image = Image.getInstance(bytes);
      image.scaleToFit(80, 80);
      return image;
    } catch (Exception e) {
      // AC-11: the logo is optional and never blocks generating the rest of the KuDE.
      return null;
    }
  }

  private void addTimbradoAndSaleBlock(
      Document document, Invoice invoice, SifenInvoiceHeader header, Font labelFont, Font bodyFont)
      throws DocumentException {
    ZoneId zone = timeProperties.zoneId();
    Paragraph p = new Paragraph();
    p.setSpacingBefore(8);
    addLine(
        p,
        "RUC",
        header.issuer().ruc() + "-" + header.issuer().rucCheckDigit(),
        labelFont,
        bodyFont);
    addLine(p, "Timbrado N°", header.stampNumber(), labelFont, bodyFont);
    addLine(
        p,
        "Vigencia del timbrado",
        DATE_FORMAT.format(header.stampValidFrom())
            + " - "
            + DATE_FORMAT.format(header.stampValidUntil()),
        labelFont,
        bodyFont);
    addLine(
        p,
        "Comprobante N°",
        String.format(
            "%03d-%03d-%07d",
            header.establishment(), header.expeditionPoint(), invoice.getInvoiceNumber()),
        labelFont,
        bodyFont);
    addLine(
        p,
        "Fecha y hora de emisión",
        DATE_TIME_FORMAT.format(invoice.getIssuedAt().atZone(zone)),
        labelFont,
        bodyFont);
    addLine(p, "Condición de venta", "Contado", labelFont, bodyFont);
    addLine(p, "Moneda", "Guaraníes (PYG)", labelFont, bodyFont);
    document.add(p);
  }

  private static boolean isReceiverIdentified(SifenInvoiceHeader header) {
    SifenReceiverData r = header.receiver();
    return hasText(r.ruc()) || hasText(r.identityDocumentNumber()) || hasText(r.name());
  }

  private void addClientBlock(
      Document document, Invoice invoice, SifenInvoiceHeader header, Font labelFont, Font bodyFont)
      throws DocumentException {
    SifenReceiverData receiver = header.receiver();
    Client client = invoice.getClient();
    Paragraph p = new Paragraph();
    p.setSpacingBefore(8);
    if (hasText(receiver.ruc())) {
      addLine(p, "RUC del cliente", receiver.ruc(), labelFont, bodyFont);
    } else if (hasText(receiver.identityDocumentNumber())) {
      addLine(p, "Documento del cliente", receiver.identityDocumentNumber(), labelFont, bodyFont);
    }
    if (hasText(receiver.name())) {
      addLine(p, "Cliente", receiver.name(), labelFont, bodyFont);
    }
    if (hasText(receiver.address())) {
      addLine(p, "Dirección", receiver.address(), labelFont, bodyFont);
    }
    if (client != null && hasText(client.getPhone())) {
      addLine(p, "Teléfono", client.getPhone(), labelFont, bodyFont);
    }
    if (client != null && hasText(client.getEmail())) {
      addLine(p, "Correo electrónico", client.getEmail(), labelFont, bodyFont);
    }
    addLine(p, "Tipo de transacción", "Operación presencial", labelFont, bodyFont);
    document.add(p);
  }

  private void addQrAndControlNumberBlock(
      Document document,
      Invoice invoice,
      SifenInvoiceHeader header,
      Font bodyFont,
      Font labelFont,
      Font legendFont,
      Font testLegendFont)
      throws DocumentException {
    Paragraph spacer = new Paragraph(" ");
    spacer.setSpacingBefore(8);
    document.add(spacer);

    PdfPTable table = new PdfPTable(2);
    table.setWidthPercentage(100);
    table.setWidths(new float[] {1f, 3f});

    byte[] qrPng = qrImageService.renderPng(invoice.getSifenQrUrl(), QR_PIXELS);
    Image qrImage;
    try {
      qrImage = Image.getInstance(qrPng);
      qrImage.scaleToFit(QR_WIDTH_POINTS, QR_WIDTH_POINTS);
    } catch (Exception e) {
      throw new IllegalStateException("Failed to embed QR image", e);
    }
    PdfPCell qrCell = new PdfPCell(qrImage, false);
    qrCell.setBorder(0);
    qrCell.setPadding(4);
    table.addCell(qrCell);

    Paragraph info = new Paragraph();
    // AC-08: the full 44-char CDC, grouped visually in eleven 4-character blocks.
    addLine(
        info,
        "Número de control (CDC)",
        groupControlNumber(header.controlNumber()),
        labelFont,
        bodyFont);
    info.add(
        new Chunk(
            "Consulte este comprobante en: " + invoice.getSifenPublicConsultationUrl() + "\n",
            bodyFont));
    // AC-09: legend identifying this as a graphical representation of an electronic document.
    info.add(
        new Chunk("KuDE - Representación gráfica de un Documento Electrónico (DE)\n", legendFont));
    // AC-15: test-environment KuDEs must show the "no commercial/fiscal value" legend.
    if (header.testEnvironmentNotice()) {
      info.add(
          new Chunk(
              "DE generado en ambiente de prueba - sin valor comercial ni fiscal", testLegendFont));
    }
    PdfPCell infoCell = new PdfPCell();
    infoCell.setBorder(0);
    infoCell.addElement(info);
    table.addCell(infoCell);

    document.add(table);
  }

  /**
   * AC-08: eleven 4-character blocks, e.g. "0144 4440 1700 1001 0014 5282 2017 0125 1587 3260 988"
   * +1.
   */
  static String groupControlNumber(String cdc) {
    StringBuilder sb = new StringBuilder();
    for (int i = 0; i < cdc.length(); i += 4) {
      if (i > 0) {
        sb.append(' ');
      }
      sb.append(cdc, i, Math.min(i + 4, cdc.length()));
    }
    return sb.toString();
  }

  private void addItemsTable(
      Document document, SifenInvoiceDetail detail, Font labelFont, Font bodyFont)
      throws DocumentException {
    Paragraph spacer = new Paragraph(" ");
    spacer.setSpacingBefore(8);
    document.add(spacer);

    PdfPTable table = new PdfPTable(9);
    table.setWidthPercentage(100);
    table.setWidths(new float[] {8, 22, 8, 6, 10, 8, 10, 10, 10});
    addHeaderCell(table, "Código", labelFont);
    addHeaderCell(table, "Descripción", labelFont);
    addHeaderCell(table, "Unidad", labelFont);
    addHeaderCell(table, "Cant.", labelFont);
    addHeaderCell(table, "P. Unitario", labelFont);
    addHeaderCell(table, "Descuento", labelFont);
    addHeaderCell(table, "Exento", labelFont);
    addHeaderCell(table, "IVA 5%", labelFont);
    addHeaderCell(table, "IVA 10%", labelFont);

    for (SifenInvoiceLine line : detail.lines()) {
      addCell(table, line.internalCode(), bodyFont, Element.ALIGN_LEFT);
      addCell(table, line.description(), bodyFont, Element.ALIGN_LEFT);
      addCell(table, "Unidad", bodyFont, Element.ALIGN_CENTER);
      addCell(table, String.valueOf(line.quantity()), bodyFont, Element.ALIGN_RIGHT);
      addCell(table, formatMoney(line.unitPrice()), bodyFont, Element.ALIGN_RIGHT);
      addCell(table, formatMoney(line.discountAmount()), bodyFont, Element.ALIGN_RIGHT);
      BigDecimal rate = line.taxRatePercent();
      addCell(
          table,
          rate.signum() == 0 ? formatMoney(line.netTotal()) : "",
          bodyFont,
          Element.ALIGN_RIGHT);
      addCell(
          table,
          rate.compareTo(BigDecimal.valueOf(5)) == 0 ? formatMoney(line.netTotal()) : "",
          bodyFont,
          Element.ALIGN_RIGHT);
      addCell(
          table,
          rate.compareTo(BigDecimal.valueOf(10)) == 0 ? formatMoney(line.netTotal()) : "",
          bodyFont,
          Element.ALIGN_RIGHT);
    }
    document.add(table);
  }

  private void addTotalsBlock(
      Document document, SifenInvoiceTotals totals, Font labelFont, Font bodyFont)
      throws DocumentException {
    // AC-12: this is the last content added to the flowing document, so it always lands on the
    // real last page — no manual page-break bookkeeping needed.
    Paragraph p = new Paragraph();
    p.setSpacingBefore(10);
    addLine(p, "Subtotal", formatMoney(totals.grossTotal()), labelFont, bodyFont);
    addLine(p, "Total de la operación", formatMoney(totals.netTotal()), labelFont, bodyFont);
    addLine(p, "Total en Guaraníes", formatMoney(totals.netTotal()), labelFont, bodyFont);
    addLine(p, "Liquidación IVA 5%", formatMoney(totals.iva5()), labelFont, bodyFont);
    addLine(p, "Liquidación IVA 10%", formatMoney(totals.iva10()), labelFont, bodyFont);
    addLine(p, "Total IVA", formatMoney(totals.totalIva()), labelFont, bodyFont);
    document.add(p);
  }

  private void addOptionalMessage(Document document, BusinessProfile profile, Font bodyFont)
      throws DocumentException {
    // AC-11's second permitted exception: a free message, configured by the business, never sent
    // to SIFEN.
    if (profile != null && hasText(profile.getKudeFooterMessage())) {
      Paragraph p = new Paragraph(profile.getKudeFooterMessage(), bodyFont);
      p.setSpacingBefore(10);
      document.add(p);
    }
  }

  private static void addLine(
      Paragraph p, String label, String value, Font labelFont, Font bodyFont) {
    p.add(new Chunk(label + ": ", labelFont));
    p.add(new Chunk((value != null ? value : "") + "\n", bodyFont));
  }

  private static void addHeaderCell(PdfPTable table, String text, Font font) {
    PdfPCell cell = new PdfPCell(new com.lowagie.text.Phrase(text, font));
    cell.setHorizontalAlignment(Element.ALIGN_CENTER);
    cell.setGrayFill(0.9f);
    table.addCell(cell);
  }

  private static void addCell(PdfPTable table, String text, Font font, int align) {
    PdfPCell cell = new PdfPCell(new com.lowagie.text.Phrase(text == null ? "" : text, font));
    cell.setHorizontalAlignment(align);
    table.addCell(cell);
  }

  private static String formatMoney(BigDecimal v) {
    if (v == null) {
      return "0";
    }
    java.text.DecimalFormatSymbols sym =
        java.text.DecimalFormatSymbols.getInstance(Locale.forLanguageTag("es-PY"));
    sym.setGroupingSeparator('.');
    java.text.DecimalFormat df = new java.text.DecimalFormat("#,##0", sym);
    return df.format(v.setScale(0, java.math.RoundingMode.HALF_UP));
  }

  private static boolean hasText(String s) {
    return s != null && !s.isBlank();
  }

  private static String joinNonBlank(String separator, String... parts) {
    StringBuilder sb = new StringBuilder();
    for (String part : parts) {
      if (hasText(part)) {
        if (sb.length() > 0) {
          sb.append(separator);
        }
        sb.append(part);
      }
    }
    return sb.toString();
  }

  /**
   * AC-12: "Página X / Y" on every page — the total-pages placeholder trick (iText/OpenPDF idiom).
   */
  private static final class PageNumberEvent extends PdfPageEventHelper {
    private PdfTemplate totalPagesTemplate;
    private com.lowagie.text.pdf.BaseFont baseFont;

    @Override
    public void onOpenDocument(PdfWriter writer, Document document) {
      totalPagesTemplate = writer.getDirectContent().createTemplate(50, 20);
      try {
        baseFont =
            com.lowagie.text.pdf.BaseFont.createFont(
                com.lowagie.text.pdf.BaseFont.HELVETICA,
                com.lowagie.text.pdf.BaseFont.CP1252,
                com.lowagie.text.pdf.BaseFont.NOT_EMBEDDED);
      } catch (DocumentException | java.io.IOException e) {
        throw new IllegalStateException("Failed to load page-number font", e);
      }
    }

    @Override
    public void onEndPage(PdfWriter writer, Document document) {
      com.lowagie.text.pdf.PdfContentByte cb = writer.getDirectContent();
      String text = "Página " + writer.getPageNumber() + " / ";
      float x = document.right() - 60;
      float y = document.bottom() - 20;
      cb.beginText();
      cb.setFontAndSize(baseFont, 8);
      cb.showTextAligned(Element.ALIGN_LEFT, text, x, y, 0);
      cb.endText();
      float textWidth = baseFont.getWidthPoint(text, 8);
      cb.addTemplate(totalPagesTemplate, x + textWidth, y);
    }

    @Override
    public void onCloseDocument(PdfWriter writer, Document document) {
      totalPagesTemplate.beginText();
      totalPagesTemplate.setFontAndSize(baseFont, 8);
      totalPagesTemplate.setTextMatrix(0, 0);
      totalPagesTemplate.showText(String.valueOf(writer.getPageNumber()));
      totalPagesTemplate.endText();
    }
  }
}
