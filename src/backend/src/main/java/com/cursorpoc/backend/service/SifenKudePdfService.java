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
import java.time.Instant;
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
 *
 * <p><b>SIFEN HU-17 (EP-05, Fase 4):</b> the rendering core ({@link #render}) was generalized from
 * "always a factura electrónica" to any {@link SifenDocumentType} — it now takes the document type,
 * issue instant, document number, QR data and (nullable) {@link Client} as plain values instead of
 * reading them off a persisted {@link Invoice}, and prints a "Tipo de comprobante" legend using
 * {@link SifenDocumentType#description()}. {@link #buildKudePdf(long, long)} (the only production
 * entry point — this peluquería only ever issues facturas) still resolves those values from a
 * persisted, SIFEN-approved {@link Invoice} exactly as before, always with {@link
 * SifenDocumentType#FACTURA}; {@link #buildHomologationKudePdf} is the new entry point HU-17 added
 * for the other 4 document types the DNIT's homologación requires (nota de crédito/débito,
 * autofactura, nota de remisión), none of which this app persists as an {@link Invoice} — it skips
 * {@link #requireDeliverableInvoice} entirely since there is no DB-backed invoice to check, by
 * design (this is homologation-only scope, per EP-05's own intro, not a new production capability).
 * Every other layout choice (items table, totals, QR/legend block, page numbering) is shared
 * unchanged across all 5 types — the DNIT manual and HU-08's own findings don't call for a
 * materially different KuDE structure per type, only the correct type legend.
 */
@Service
public class SifenKudePdfService {

  /** AC-13: minimum 25mm, of which zxing's own quiet zone covers the "3mm margen seguro" part. */
  static final float QR_WIDTH_POINTS = 30f * (72f / 25.4f);

  /** Issue #179: height of the header's logo box (was 70pt). */
  static final float LOGO_CELL_HEIGHT = 96f;

  /**
   * Header row column widths: logo | business info (address) | timbrado data. Issue #179 enlarged
   * the logo column at the expense of the address column ({@code 2 → 4} / {@code 12 → 10}); the
   * timbrado column keeps its exact {@code 5 / 19} share (RUC, Timbrado, vigencia, doc type +
   * number must not move).
   */
  static final float[] HEADER_COLUMN_WEIGHTS = {4f, 10f, 5f};

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

  /**
   * RT-28 (Hardening_SIFEN.md): the Manual Técnico V150's general "validación posterior" model
   * (pág. 19, 24) lets the KuDE be delivered at the point of sale before SIFEN approves — the
   * document's legal validity is simply conditioned on that later approval, and the receiver is
   * expected to verify it via the CDC/QR already printed (AC-08/AC-13). {@link
   * #requireDeliverableInvoice} therefore also accepts {@link
   * SifenSubmissionStatus#PENDING_VERIFICATION} (previously: only Aprobado/Aprobado con
   * observación), and {@link #render} prints a legend flagging that the document is still pending
   * SIFEN's validation in that case.
   *
   * <p>RT-20 (Hardening_SIFEN.md): also accepts {@link SifenSubmissionStatus#QUEUED} — signing (and
   * persisting the CDC/QR) now happens synchronously in {@code
   * SifenInvoiceSubmissionService#prepareAndSign} before the invoice is ever transmitted, so a
   * QUEUED invoice already has everything the KuDE needs, same as PENDING_VERIFICATION.
   */
  @Transactional(readOnly = true)
  public KudePdfResult buildKudePdf(long tenantId, long invoiceId) {
    return buildKudePdf(tenantId, invoiceId, false, false, "");
  }

  /**
   * KuDE de muestra "estilo producción": el mismo KuDE, pero con la razón social real del emisor en
   * vez de la leyenda obligatoria del ambiente de prueba (Manual Técnico, validación D105 §10),
   * para mostrarle a un cliente cómo se verá su factura en producción. El PDF es, por lo demás,
   * idéntico al KuDE real (mismo layout, CDC, ítems y totales); el QR y la URL de consulta pública
   * siguen siendo los persistidos en la factura (ambiente de prueba) porque no se pueden regenerar
   * a producción sin el CSC de producción del contribuyente. La única marca de que es una muestra
   * es el prefijo {@code MUESTRA-} del nombre de archivo. Sólo tiene sentido mientras la conexión
   * SIFEN está en el ambiente de prueba — {@code SifenKudeController} lo rechaza en producción,
   * donde la muestra sería idéntica al KuDE real.
   */
  @Transactional(readOnly = true)
  public KudePdfResult buildProductionSampleKudePdf(long tenantId, long invoiceId) {
    return buildKudePdf(tenantId, invoiceId, false, true, "MUESTRA-");
  }

  /**
   * Issue #173: the cancellation-notice email (sent after SIFEN approves the cancellation, when the
   * invoice is already {@code CANCELLED}) still attaches this document's KuDE — the receiver needs
   * to see exactly which document was voided.
   */
  @Transactional(readOnly = true)
  public KudePdfResult buildCancelledKudePdf(long tenantId, long invoiceId) {
    return buildKudePdf(tenantId, invoiceId, true, false, "");
  }

  private KudePdfResult buildKudePdf(
      long tenantId,
      long invoiceId,
      boolean allowCancelled,
      boolean forceRealIssuerName,
      String filenamePrefix) {
    Invoice invoice = requireDeliverableInvoice(tenantId, invoiceId, allowCancelled);
    SifenInvoiceHeader header =
        forceRealIssuerName
            ? headerService.buildHeader(tenantId, invoiceId, true)
            : headerService.buildHeader(tenantId, invoiceId);
    SifenInvoiceDetail detail = detailService.buildDetail(tenantId, invoiceId);
    BusinessProfile profile = businessProfileRepository.findByTenantId(tenantId).orElse(null);

    SifenSubmissionStatus status = invoice.getSifenSubmissionStatus();
    boolean pendingValidation =
        status == SifenSubmissionStatus.QUEUED
            || status == SifenSubmissionStatus.PENDING_VERIFICATION;
    byte[] pdf =
        render(
            SifenDocumentType.FACTURA,
            invoice.getIssuedAt(),
            invoice.getInvoiceNumber(),
            invoice.getSifenQrUrl(),
            invoice.getSifenPublicConsultationUrl(),
            header,
            detail,
            profile,
            invoice.getClient(),
            pendingValidation);
    return new KudePdfResult(
        pdf,
        filenamePrefix + buildFilename(header, invoice.getIssuedAt(), invoice.getInvoiceNumber()));
  }

  /**
   * SIFEN HU-17 (EP-05, Fase 4, homologación): renders a KuDE for one of the 4 additional document
   * types the DNIT's homologación requires — nota de crédito/débito, autofactura, nota de remisión
   * — none of which this peluquería persists as an {@link Invoice} in real operation (it never
   * issues them). Deliberately bypasses {@link #requireDeliverableInvoice} (there's no DB-backed
   * invoice to check) — the caller is responsible for only calling this with data SIFEN genuinely
   * returned {@code Aprobado}/{@code Aprobado con observación} for, same discipline {@link
   * #buildKudePdf} enforces via the database for real invoices.
   */
  public KudePdfResult buildHomologationKudePdf(
      SifenDocumentType documentType,
      Instant issuedAt,
      int documentNumber,
      String qrUrl,
      String publicConsultationUrl,
      SifenInvoiceHeader header,
      SifenInvoiceDetail detail) {
    byte[] pdf =
        render(
            documentType,
            issuedAt,
            documentNumber,
            qrUrl,
            publicConsultationUrl,
            header,
            detail,
            null,
            null,
            false);
    return new KudePdfResult(pdf, buildFilename(header, issuedAt, documentNumber));
  }

  /**
   * RT-28: widened from "only Aprobado/Aprobado con observación" to also accept {@code
   * PENDING_VERIFICATION} — a submitted-but-not-yet-answered invoice already has everything the
   * KuDE needs (CDC + QR are persisted by {@link SifenInvoiceSubmissionService} before it ever
   * calls SIFEN — see {@code persistQrData}). RT-20: also {@code QUEUED}, for the same reason —
   * {@code prepareAndSign} persists both before the invoice is ever transmitted. {@code REJECTED},
   * {@code CANCELLED} and {@code null} (never submitted) still 409.
   */
  @Transactional(readOnly = true)
  Invoice requireDeliverableInvoice(long tenantId, long invoiceId) {
    return requireDeliverableInvoice(tenantId, invoiceId, false);
  }

  Invoice requireDeliverableInvoice(long tenantId, long invoiceId, boolean allowCancelled) {
    Invoice invoice =
        invoiceRepository
            .findByIdAndTenant_Id(invoiceId, tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "INVOICE_NOT_FOUND"));
    SifenSubmissionStatus status = invoice.getSifenSubmissionStatus();
    boolean deliverable =
        status == SifenSubmissionStatus.APPROVED
            || status == SifenSubmissionStatus.APPROVED_WITH_OBSERVATION
            || status == SifenSubmissionStatus.PENDING_VERIFICATION
            || status == SifenSubmissionStatus.QUEUED
            || (allowCancelled && status == SifenSubmissionStatus.CANCELLED);
    if (!deliverable) {
      throw new ResponseStatusException(
          HttpStatus.CONFLICT, "SIFEN_KUDE_ONLY_FOR_APPROVED_INVOICES");
    }
    if (invoice.getSifenQrUrl() == null || invoice.getSifenQrUrl().isBlank()) {
      // Defensive only: every invoice that reached at least QUEUED went through prepareAndSign,
      // which always persists this first — should be unreachable in practice.
      throw new ResponseStatusException(HttpStatus.CONFLICT, "SIFEN_KUDE_MISSING_QR_DATA");
    }
    if (invoice.getClient() != null) {
      Hibernate.initialize(invoice.getClient());
    }
    return invoice;
  }

  String buildFilename(SifenInvoiceHeader header, Instant issuedAt, int documentNumber) {
    DateTimeFormatter fileDateFmt =
        DateTimeFormatter.ofPattern("yyyyMMdd").withZone(timeProperties.zoneId());
    String date = fileDateFmt.format(issuedAt);
    return "KUDE-"
        + date
        + "-"
        + header.stampNumber()
        + "-"
        + String.format("%07d", documentNumber)
        + ".pdf";
  }

  byte[] render(
      SifenDocumentType documentType,
      Instant issuedAt,
      int documentNumber,
      String qrUrl,
      String publicConsultationUrl,
      SifenInvoiceHeader header,
      SifenInvoiceDetail detail,
      BusinessProfile profile,
      Client client,
      boolean pendingValidation) {
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

      // Manual Técnico V150, Gráfica N° 09: one continuous bordered "card" — every section below
      // is a PdfPTable whose default (bordered) cells form the section's box and, stacked with no
      // spacing, the ruled lines between sections. The QR/CDC block is placed right after the
      // header/sale data (not at the very bottom as in the manual's single-page example) so it
      // stays guaranteed on page 1 per AC-13 even when the item table spills onto later pages.
      addHeaderBlock(
          document,
          documentType,
          documentNumber,
          header,
          profile,
          titleFont,
          subtitleFont,
          labelFont,
          bodyFont);
      addSaleAndReceiverBlock(document, issuedAt, header, client, labelFont, bodyFont);
      addQrAndControlNumberBlock(
          document,
          qrUrl,
          publicConsultationUrl,
          header,
          bodyFont,
          labelFont,
          legendFont,
          pendingValidation);
      addItemsTable(document, detail, labelFont, bodyFont);
      addTotalsBlock(document, detail.totals(), labelFont, bodyFont);
      addOptionalMessage(document, profile, bodyFont);

      document.close();
      return baos.toByteArray();
    } catch (DocumentException e) {
      throw new IllegalStateException("Failed to build KuDE PDF", e);
    }
  }

  /**
   * Manual Técnico page 198 style "encabezado" box: logo (or a placeholder box, per the manual's
   * own field-reference diagram on page 195), then the business's identifying data, then the
   * timbrado data and, in bold, the document type and number — matching the sample's "FACTURA
   * ELECTRÓNICA / 001-001-0000001" block.
   */
  private void addHeaderBlock(
      Document document,
      SifenDocumentType documentType,
      int documentNumber,
      SifenInvoiceHeader header,
      BusinessProfile profile,
      Font titleFont,
      Font subtitleFont,
      Font labelFont,
      Font bodyFont)
      throws DocumentException {
    SifenIssuerData issuer = header.issuer();
    String logoDataUrl = profile != null ? profile.getLogoDataUrl() : null;

    // Issue #179: a bigger logo, taken from the business-info (address) column — the timbrado
    // column (RUC / Timbrado / vigencia / doc type + number) keeps its exact 5/19 ≈ 26% share.
    // logo | business info | timbrado data ≈ 21% / 53% / 26%.
    PdfPTable table = new PdfPTable(3);
    table.setWidthPercentage(100);
    table.setWidths(HEADER_COLUMN_WEIGHTS);
    table.addCell(logoCell(logoDataUrl));

    Paragraph businessInfo = new Paragraph();
    businessInfo.add(new Chunk(issuer.businessName() + "\n", titleFont));
    if (hasText(issuer.fantasyName())) {
      businessInfo.add(new Chunk(issuer.fantasyName() + "\n", subtitleFont));
    }
    if (hasText(issuer.economicActivityDescription())) {
      businessInfo.add(new Chunk(issuer.economicActivityDescription() + "\n", bodyFont));
    }
    if (hasText(issuer.address())) {
      businessInfo.add(new Chunk(issuer.address() + "\n", bodyFont));
    }
    String city = joinNonBlank(", ", issuer.cityName(), issuer.departmentName());
    if (!city.isBlank()) {
      businessInfo.add(new Chunk(city, bodyFont));
    }
    PdfPCell businessCell = new PdfPCell();
    businessCell.setPadding(6);
    businessCell.addElement(businessInfo);
    table.addCell(businessCell);

    Paragraph timbradoInfo = new Paragraph();
    addLine(timbradoInfo, "RUC", issuer.ruc() + "-" + issuer.rucCheckDigit(), labelFont, bodyFont);
    addLine(timbradoInfo, "Timbrado N°", header.stampNumber(), labelFont, bodyFont);
    // Manual Técnico page 195: "Fecha de fin de vigencia" (C005) is marked removed (struck
    // through in red in both the field-reference table and the populated example) — the
    // populated example on page 198 only shows RUC/Timbrado/Fecha de Inicio de Vigencia.
    addLine(
        timbradoInfo,
        "Fecha de Inicio de Vigencia",
        DATE_FORMAT.format(header.stampValidFrom()),
        labelFont,
        bodyFont);

    // Same font as the RUC/Timbrado labels to its left — no separate, larger doc-type font.
    Paragraph docTypeInfo = new Paragraph();
    docTypeInfo.setSpacingBefore(6);
    docTypeInfo.setAlignment(Element.ALIGN_RIGHT);
    docTypeInfo.add(new Chunk(documentType.description() + "\n", labelFont));
    docTypeInfo.add(
        new Chunk(
            String.format(
                "%03d-%03d-%07d", header.establishment(), header.expeditionPoint(), documentNumber),
            labelFont));

    PdfPCell rightCell = new PdfPCell();
    rightCell.setPadding(6);
    rightCell.addElement(timbradoInfo);
    rightCell.addElement(docTypeInfo);
    table.addCell(rightCell);

    document.add(table);
  }

  /**
   * AC-11's first permitted exception: the business's own logo, read verbatim from {@link
   * BusinessProfile}, never sent to SIFEN. Until one is configured, renders a bordered "LOGO"
   * placeholder box instead — the same idea as the manual's own field-reference diagram (page 195:
   * "Espacio reservado para el logo del emisor (opcional)") — so the header box's grid stays
   * identical before and after a real logo is uploaded.
   */
  private PdfPCell logoCell(String logoDataUrl) {
    Image logo =
        logoDataUrl != null && logoDataUrl.startsWith("data:image/")
            ? logoImage(logoDataUrl)
            : null;
    if (logo != null) {
      PdfPCell cell = new PdfPCell(logo, true);
      // Issue #179: bigger logo box.
      cell.setFixedHeight(LOGO_CELL_HEIGHT);
      cell.setHorizontalAlignment(Element.ALIGN_CENTER);
      cell.setVerticalAlignment(Element.ALIGN_MIDDLE);
      return cell;
    }
    PdfPCell placeholder =
        new PdfPCell(
            new com.lowagie.text.Phrase(
                "LOGO", new Font(Font.HELVETICA, 9, Font.BOLD, java.awt.Color.GRAY)));
    placeholder.setFixedHeight(LOGO_CELL_HEIGHT);
    placeholder.setHorizontalAlignment(Element.ALIGN_CENTER);
    placeholder.setVerticalAlignment(Element.ALIGN_MIDDLE);
    return placeholder;
  }

  private Image logoImage(String logoDataUrl) {
    try {
      String base64 = logoDataUrl.substring(logoDataUrl.indexOf(',') + 1);
      byte[] bytes = Base64.getDecoder().decode(base64);
      Image image = Image.getInstance(bytes);
      // Issue #179: fill the enlarged logo box.
      image.scaleToFit(115, LOGO_CELL_HEIGHT - 6);
      return image;
    } catch (Exception e) {
      // AC-11: the logo is optional and never blocks generating the rest of the KuDE.
      return null;
    }
  }

  /**
   * Manual Técnico page 198 style "datos generales" + "datos del receptor" box: one continuous
   * bordered grid, touching the header box directly above it. Sale data always renders; receptor
   * rows only when the invoice has an identified client (same gate HU-08 AC-05 always used).
   */
  private void addSaleAndReceiverBlock(
      Document document,
      Instant issuedAt,
      SifenInvoiceHeader header,
      Client client,
      Font labelFont,
      Font bodyFont)
      throws DocumentException {
    ZoneId zone = timeProperties.zoneId();
    PdfPTable table = new PdfPTable(6);
    table.setWidthPercentage(100);

    // Issue #179: pack the sale/receiver fields into a compact two-up grid (colspan 3 + 3) instead
    // of one full-width row per field. Issue #173 item 6: "Cuotas" / "Tipo de Cambio" stay gone.
    addGridCell(
        table,
        "Fecha y hora de Emisión",
        DATE_TIME_FORMAT.format(issuedAt.atZone(zone)),
        3,
        labelFont,
        bodyFont);
    addGridCell(table, "Condición de Venta", "Contado", 3, labelFont, bodyFont);
    addGridCell(table, "Moneda", "Guaraníes (PYG)", 3, labelFont, bodyFont);
    addGridCell(table, "Tipo de Operación", "Operación presencial", 3, labelFont, bodyFont);

    // The receiver block always renders now (Issue #173 item 4). "RUC del Cliente" falls back to
    // "X" and "Nombre o Razón Social" to "Sin nombre" for a "Sin nominar" comprobante — i.e. one
    // with no RUC, no identity document and no real display name (the occasional-client placeholder
    // "CONSUMIDOR FINAL" isn't a real name).
    SifenReceiverData receiver = header.receiver();
    boolean hasRuc = hasText(receiver.ruc());
    boolean hasDoc = !hasRuc && hasText(receiver.identityDocumentNumber());
    boolean hasRealName =
        hasText(receiver.name())
            && !OCCASIONAL_CLIENT_DISPLAY_NAME.equalsIgnoreCase(receiver.name().trim());

    if (hasRuc) {
      addGridCell(table, "RUC del Cliente", receiver.ruc(), 3, labelFont, bodyFont);
    } else if (hasDoc) {
      addGridCell(
          table,
          "Documento del Cliente",
          receiver.identityDocumentNumber(),
          3,
          labelFont,
          bodyFont);
    } else {
      addGridCell(table, "RUC del Cliente", "X", 3, labelFont, bodyFont);
    }
    addGridCell(
        table,
        "Nombre o Razón Social",
        hasRealName ? receiver.name() : "Sin nombre",
        3,
        labelFont,
        bodyFont);

    if (hasRuc || hasDoc || hasRealName) {
      String phone = client != null ? client.getPhone() : null;
      String email = client != null ? client.getEmail() : null;
      if (hasText(phone) || hasText(email)) {
        addGridCell(table, "Teléfono", hasText(phone) ? phone : "", 3, labelFont, bodyFont);
        addGridCell(
            table, "Correo Electrónico", hasText(email) ? email : "", 3, labelFont, bodyFont);
      }
    }
    if (hasText(receiver.address())) {
      addGridCell(table, "Dirección", receiver.address(), 6, labelFont, bodyFont);
    }

    document.add(table);
  }

  /**
   * Mirrors {@code InvoiceService.OCCASIONAL_CLIENT_DISPLAY_NAME} — the placeholder isn't a name.
   */
  private static final String OCCASIONAL_CLIENT_DISPLAY_NAME = "CONSUMIDOR FINAL";

  /** One bordered "label: value" cell spanning {@code colspan} of the grid's 6 columns. */
  private static void addGridCell(
      PdfPTable table, String label, String value, int colspan, Font labelFont, Font bodyFont) {
    PdfPCell cell = new PdfPCell();
    cell.setColspan(colspan);
    cell.setPadding(4);
    Paragraph p = new Paragraph();
    addLine(p, label, value, labelFont, bodyFont);
    cell.addElement(p);
    table.addCell(cell);
  }

  private void addQrAndControlNumberBlock(
      Document document,
      String qrUrl,
      String publicConsultationUrl,
      SifenInvoiceHeader header,
      Font bodyFont,
      Font labelFont,
      Font legendFont,
      boolean pendingValidation)
      throws DocumentException {
    PdfPTable table = new PdfPTable(2);
    table.setWidthPercentage(100);
    table.setWidths(new float[] {1f, 3f});

    byte[] qrPng = qrImageService.renderPng(qrUrl, QR_PIXELS);
    Image qrImage;
    try {
      qrImage = Image.getInstance(qrPng);
      qrImage.scaleToFit(QR_WIDTH_POINTS, QR_WIDTH_POINTS);
    } catch (Exception e) {
      throw new IllegalStateException("Failed to embed QR image", e);
    }
    PdfPCell qrCell = new PdfPCell(qrImage, false);
    qrCell.setPadding(6);
    qrCell.setHorizontalAlignment(Element.ALIGN_CENTER);
    qrCell.setVerticalAlignment(Element.ALIGN_MIDDLE);
    table.addCell(qrCell);

    Paragraph info = new Paragraph();
    // AC-08: the full 44-char CDC, grouped visually in eleven 4-character blocks.
    addLine(
        info,
        "Número de control (CDC)",
        groupControlNumber(header.controlNumber()),
        labelFont,
        bodyFont);
    info.add(new Chunk("Consulte este comprobante en: " + publicConsultationUrl, bodyFont));
    // AC-09: legend identifying this as a graphical representation of an electronic document.
    info.add(
        new Chunk("\nKuDE - Representación gráfica de un Documento Electrónico (DE)", legendFont));
    if (pendingValidation) {
      // RT-28: the manual imposes no fixed legend text for this case (unlike the test-environment
      // legend), only that validity is conditioned on SIFEN's later approval — bold + distinct
      // from the legend above so it reads as a status flag, not part of the standard KuDE legend.
      Font pendingFont = new Font(Font.HELVETICA, 8, Font.BOLD, java.awt.Color.RED);
      info.add(
          new Chunk(
              "\nDOCUMENTO SUJETO A VALIDACIÓN POR LA SET - válido condicionado a la aprobación"
                  + " del DE en SIFEN",
              pendingFont));
    }
    PdfPCell infoCell = new PdfPCell();
    infoCell.setPadding(6);
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
    PdfPTable table = new PdfPTable(9);
    table.setWidthPercentage(100);
    table.setWidths(new float[] {8, 22, 8, 6, 10, 8, 10, 10, 10});
    // Manual Técnico page 196/198: Exentas/5%/10% render as sub-columns under one merged "Valor
    // de Venta" header, with the other 6 columns spanning both header rows.
    addHeaderCell(table, "Código", labelFont, 2, 1);
    addHeaderCell(table, "Descripción", labelFont, 2, 1);
    addHeaderCell(table, "Unidad", labelFont, 2, 1);
    addHeaderCell(table, "Cant.", labelFont, 2, 1);
    addHeaderCell(table, "P. Unitario", labelFont, 2, 1);
    addHeaderCell(table, "Desc.", labelFont, 2, 1);
    addHeaderCell(table, "Valor de Venta", labelFont, 1, 3);
    addHeaderCell(table, "Exentas", labelFont, 1, 1);
    addHeaderCell(table, "5%", labelFont, 1, 1);
    addHeaderCell(table, "10%", labelFont, 1, 1);

    for (SifenInvoiceLine line : detail.lines()) {
      addCell(table, line.internalCode(), bodyFont, Element.ALIGN_LEFT);
      addCell(table, line.description(), bodyFont, Element.ALIGN_LEFT);
      addCell(table, "Unidad", bodyFont, Element.ALIGN_CENTER);
      addCell(table, String.valueOf(line.quantity()), bodyFont, Element.ALIGN_RIGHT);
      addCell(table, formatMoney(line.unitPrice()), bodyFont, Element.ALIGN_RIGHT);
      addCell(table, formatMoney(line.totalDiscountAmount()), bodyFont, Element.ALIGN_RIGHT);
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

  /**
   * Label column + the three "Valor de Venta" sub-columns (Exentas / 5% / 10%). Weights sum to 92
   * and reproduce {@link #addItemsTable}'s column widths exactly (label 0-62, Exentas 62-72, 5%
   * 72-82, 10% 82-92), so every totals amount sits directly under the items-table column it belongs
   * to.
   */
  private static final float[] TOTALS_COLUMN_WEIGHTS = {62f, 10f, 10f, 10f};

  /** 0 = Exentas column, 1 = 5% column, 2 = 10% column. */
  static int totalsValueColumn(SifenInvoiceTotals totals) {
    if (totals.taxedSubtotal10() != null && totals.taxedSubtotal10().signum() > 0) {
      return 2;
    }
    if (totals.taxedSubtotal5() != null && totals.taxedSubtotal5().signum() > 0) {
      return 1;
    }
    // Issue #179: a fully Exenta / Exonerada operation (e.g. "Tarjeta Diplomática de exoneración
    // fiscal" receiver) — Subtotal / Total de la operación / Total en Guaraníes must fall under
    // "Exentas", never "10%".
    return 0;
  }

  private void addTotalsBlock(
      Document document, SifenInvoiceTotals totals, Font labelFont, Font bodyFont)
      throws DocumentException {
    // AC-12: this is the last content added to the flowing document, so it always lands on the
    // real last page — no manual page-break bookkeeping needed. Manual Técnico section 13.4.3
    // ("Ejemplo de subtotales y totales de KuDE (FE)").
    PdfPTable table = new PdfPTable(TOTALS_COLUMN_WEIGHTS);
    table.setWidthPercentage(100);

    int valueColumn = totalsValueColumn(totals);
    addTaxAlignedRow(
        table, "Subtotal", formatMoney(totals.grossTotal()), valueColumn, labelFont, bodyFont);
    addTaxAlignedRow(
        table,
        "Total de la operación",
        formatMoney(totals.netTotal()),
        valueColumn,
        labelFont,
        bodyFont);
    addTaxAlignedRow(
        table,
        "Total en Guaraníes",
        formatMoney(totals.netTotal()),
        valueColumn,
        labelFont,
        bodyFont);

    // IVA liquidation — the 5% / 10% amounts stay under their own columns; "Total IVA" on its own
    // row under the 10% column.
    addTotalsCell(table, "Liquidación IVA", labelFont, Element.ALIGN_LEFT, 1);
    addTotalsCell(table, "", bodyFont, Element.ALIGN_RIGHT, 1);
    addTotalsCell(table, formatMoney(totals.iva5()), bodyFont, Element.ALIGN_RIGHT, 1);
    addTotalsCell(table, formatMoney(totals.iva10()), bodyFont, Element.ALIGN_RIGHT, 1);
    addTotalsCell(table, "Total IVA", labelFont, Element.ALIGN_LEFT, 3);
    addTotalsCell(table, formatMoney(totals.totalIva()), bodyFont, Element.ALIGN_RIGHT, 1);

    document.add(table);
  }

  /**
   * One row: bold label in the label column, the amount under its "Valor de Venta" sub-column
   * ({@code valueColumn}: 0 = Exentas, 1 = 5%, 2 = 10%), the other two sub-columns left blank.
   */
  private static void addTaxAlignedRow(
      PdfPTable table, String label, String value, int valueColumn, Font labelFont, Font bodyFont) {
    PdfPCell labelCell = new PdfPCell(new com.lowagie.text.Phrase(label, labelFont));
    labelCell.setPadding(4);
    table.addCell(labelCell);
    for (int i = 0; i < 3; i++) {
      PdfPCell cell =
          new PdfPCell(new com.lowagie.text.Phrase(i == valueColumn ? value : "", bodyFont));
      cell.setHorizontalAlignment(Element.ALIGN_RIGHT);
      cell.setPadding(4);
      table.addCell(cell);
    }
  }

  private static void addTotalsCell(
      PdfPTable table, String text, Font font, int align, int colspan) {
    PdfPCell cell = new PdfPCell(new com.lowagie.text.Phrase(text, font));
    cell.setHorizontalAlignment(align);
    cell.setColspan(colspan);
    cell.setPadding(4);
    table.addCell(cell);
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

  private static void addHeaderCell(
      PdfPTable table, String text, Font font, int rowspan, int colspan) {
    PdfPCell cell = new PdfPCell(new com.lowagie.text.Phrase(text, font));
    cell.setHorizontalAlignment(Element.ALIGN_CENTER);
    cell.setVerticalAlignment(Element.ALIGN_MIDDLE);
    cell.setGrayFill(0.9f);
    cell.setRowspan(rowspan);
    cell.setColspan(colspan);
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
    // Tracks the last page actually rendered via onEndPage. writer.getPageNumber() can no
    // longer be trusted at onCloseDocument time: OpenPDF bumps its internal page counter while
    // probing whether trailing content (e.g. the totals/optional-message blocks) fits on the
    // current page, even when that probe never produces a real extra page — re-reading it here
    // was inflating the total by one on single-page KuDEs (AC-12 regression).
    private int lastPageNumber;

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
      lastPageNumber = writer.getPageNumber();
      com.lowagie.text.pdf.PdfContentByte cb = writer.getDirectContent();
      String text = "Página " + lastPageNumber + " / ";
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
      totalPagesTemplate.showText(String.valueOf(lastPageNumber));
      totalPagesTemplate.endText();
    }
  }
}
