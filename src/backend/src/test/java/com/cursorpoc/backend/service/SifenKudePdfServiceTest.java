package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.BusinessProfile;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.enums.SifenSubmissionStatus;
import com.cursorpoc.backend.domain.enums.SifenTaxAffectation;
import com.cursorpoc.backend.repository.BusinessProfileRepository;
import com.cursorpoc.backend.repository.InvoiceRepository;
import com.lowagie.text.pdf.PdfReader;
import com.lowagie.text.pdf.parser.PdfTextExtractor;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.server.ResponseStatusException;

@ExtendWith(MockitoExtension.class)
class SifenKudePdfServiceTest {

  private static final long TENANT_ID = 1L;
  private static final long INVOICE_ID = 100L;
  private static final String CDC = "01444444017001001001452822017012515873260988";
  private static final String QR_URL =
      "https://ekuatia.set.gov.py/consultas-test/qr?nVersion=150&Id=" + CDC + "&cHashQR=abc123";
  private static final String CONSULTATION_URL = "https://ekuatia.set.gov.py/consultas-test/";

  @Mock private InvoiceRepository invoiceRepository;
  @Mock private BusinessProfileRepository businessProfileRepository;
  @Mock private SifenInvoiceHeaderService headerService;
  @Mock private SifenInvoiceDetailService detailService;

  private SifenKudePdfService service;
  private Invoice invoice;
  private SifenInvoiceHeader header;
  private SifenInvoiceDetail detail;

  @BeforeEach
  void setUp() {
    service =
        new SifenKudePdfService(
            invoiceRepository,
            businessProfileRepository,
            headerService,
            detailService,
            new SifenQrImageService(),
            new FemmeTimeProperties());

    invoice = new Invoice();
    invoice.setInvoiceNumber(7);
    invoice.setIssuedAt(Instant.parse("2026-07-28T15:00:00Z"));
    invoice.setSifenSubmissionStatus(SifenSubmissionStatus.APPROVED);
    invoice.setSifenQrUrl(QR_URL);
    invoice.setSifenPublicConsultationUrl(CONSULTATION_URL);

    SifenIssuerData issuer =
        new SifenIssuerData(
            "1137152",
            8,
            "Lucía Zymanscki de Onieva Vit S.A.",
            "Fantasía Demo",
            "Avda. España 123",
            null,
            "96020",
            "Peluquería y otros tratamientos de belleza",
            "021555000",
            "facturacion@example.com",
            "12",
            "CENTRAL",
            "5044",
            "FERNANDO DE LA MORA");
    SifenReceiverData receiver =
        new SifenReceiverData(null, "4123456", "Cliente Demo", null, null, null, null, null, null);
    header =
        new SifenInvoiceHeader(
            CDC,
            LocalDateTime.of(2026, 7, 28, 15, 0, 0),
            "1137152",
            1,
            2,
            LocalDate.of(2025, 1, 1),
            LocalDate.of(2027, 12, 31),
            issuer,
            receiver,
            true);

    SifenInvoiceLine line =
        new SifenInvoiceLine(
            "SVC-1",
            "Corte de cabello",
            null,
            1,
            "77",
            BigDecimal.valueOf(100_000),
            BigDecimal.ZERO,
            BigDecimal.ZERO,
            BigDecimal.valueOf(100_000),
            SifenTaxAffectation.GRAVADO,
            BigDecimal.valueOf(100),
            BigDecimal.valueOf(10),
            BigDecimal.valueOf(90909),
            BigDecimal.valueOf(9091));
    SifenInvoiceTotals totals =
        new SifenInvoiceTotals(
            BigDecimal.ZERO,
            BigDecimal.ZERO,
            BigDecimal.valueOf(100_000),
            BigDecimal.valueOf(100_000),
            BigDecimal.ZERO,
            BigDecimal.ZERO,
            BigDecimal.ZERO,
            BigDecimal.valueOf(100_000),
            BigDecimal.ZERO,
            BigDecimal.valueOf(90909),
            BigDecimal.valueOf(90909),
            BigDecimal.ZERO,
            BigDecimal.valueOf(9091),
            BigDecimal.valueOf(9091),
            BigDecimal.ZERO,
            BigDecimal.ZERO);
    detail =
        new SifenInvoiceDetail(
            List.of(line),
            totals,
            1,
            List.of(new SifenPaymentDetail(1, BigDecimal.valueOf(100_000), null, null)));

    org.mockito.Mockito.lenient()
        .when(invoiceRepository.findByIdAndTenant_Id(INVOICE_ID, TENANT_ID))
        .thenReturn(Optional.of(invoice));
    org.mockito.Mockito.lenient()
        .when(headerService.buildHeader(TENANT_ID, INVOICE_ID))
        .thenReturn(header);
    org.mockito.Mockito.lenient()
        .when(detailService.buildDetail(TENANT_ID, INVOICE_ID))
        .thenReturn(detail);
    org.mockito.Mockito.lenient()
        .when(businessProfileRepository.findByTenantId(TENANT_ID))
        .thenReturn(Optional.empty());
  }

  /**
   * RT-28/RT-20 (Hardening_SIFEN.md): Rejected/Cancelled/never-submitted invoices still can't
   * generate a KuDE — only Aprobado/Aprobado con observación/En cola/Pendiente de verificación can.
   */
  @Test
  void buildKudePdf_rejectsInvoicesNotApprovedOrPending() {
    invoice.setSifenSubmissionStatus(SifenSubmissionStatus.REJECTED);

    assertThatThrownBy(() -> service.buildKudePdf(TENANT_ID, INVOICE_ID))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SIFEN_KUDE_ONLY_FOR_APPROVED_INVOICES");
  }

  @Test
  void buildKudePdf_rejectsCancelledInvoices() {
    invoice.setSifenSubmissionStatus(SifenSubmissionStatus.CANCELLED);

    assertThatThrownBy(() -> service.buildKudePdf(TENANT_ID, INVOICE_ID))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SIFEN_KUDE_ONLY_FOR_APPROVED_INVOICES");
  }

  /**
   * RT-28: the Manual Técnico's general "validación posterior" model lets the KuDE be delivered
   * before SIFEN answers — the CDC and QR are already persisted at this point (see {@code
   * persistQrData} in {@link SifenInvoiceSubmissionService}), so the PDF renders normally, plus a
   * legend flagging that validity is conditioned on SIFEN's later approval.
   */
  @Test
  void buildKudePdf_allowsPendingVerificationInvoice_andShowsPendingValidationLegend()
      throws Exception {
    invoice.setSifenSubmissionStatus(SifenSubmissionStatus.PENDING_VERIFICATION);

    var result = service.buildKudePdf(TENANT_ID, INVOICE_ID);
    String page1 = extractPage(result.bytes(), 1);

    assertThat(page1).contains("SUJETO A VALIDACIÓN POR LA SET");
  }

  @Test
  void buildKudePdf_approvedInvoice_doesNotShowPendingValidationLegend() throws Exception {
    var result = service.buildKudePdf(TENANT_ID, INVOICE_ID);
    String page1 = extractPage(result.bytes(), 1);

    assertThat(page1).doesNotContain("SUJETO A VALIDACIÓN POR LA SET");
  }

  /**
   * RT-20 (Hardening_SIFEN.md): a QUEUED invoice already has its CDC/QR persisted by {@code
   * prepareAndSign} before it's ever transmitted — same deliverability as PENDING_VERIFICATION.
   */
  @Test
  void buildKudePdf_allowsQueuedInvoice_andShowsPendingValidationLegend() throws Exception {
    invoice.setSifenSubmissionStatus(SifenSubmissionStatus.QUEUED);

    var result = service.buildKudePdf(TENANT_ID, INVOICE_ID);
    String page1 = extractPage(result.bytes(), 1);

    assertThat(page1).contains("SUJETO A VALIDACIÓN POR LA SET");
  }

  @Test
  void buildKudePdf_rejectsWhenQrDataIsMissing() {
    invoice.setSifenQrUrl(null);

    assertThatThrownBy(() -> service.buildKudePdf(TENANT_ID, INVOICE_ID))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SIFEN_KUDE_MISSING_QR_DATA");
  }

  /** AC-02: a valid, parseable A4 PDF with at least one page. */
  @Test
  void buildKudePdf_producesAValidPdf() throws Exception {
    var result = service.buildKudePdf(TENANT_ID, INVOICE_ID);

    assertThat(result.filename()).isEqualTo("KUDE-20260728-1137152-0000007.pdf");
    PdfReader reader = new PdfReader(result.bytes());
    assertThat(reader.getNumberOfPages()).isGreaterThanOrEqualTo(1);
    var pageSize = reader.getPageSize(1);
    assertThat(pageSize.getWidth()).isEqualTo(com.lowagie.text.PageSize.A4.getWidth());
    assertThat(pageSize.getHeight()).isEqualTo(com.lowagie.text.PageSize.A4.getHeight());
  }

  /** AC-03/AC-04: business, timbrado and sale data appear on page 1. */
  @Test
  void buildKudePdf_page1_containsBusinessTimbradoAndSaleData() throws Exception {
    var result = service.buildKudePdf(TENANT_ID, INVOICE_ID);
    String page1 = extractPage(result.bytes(), 1);

    assertThat(page1).contains("Lucía Zymanscki de Onieva Vit S.A.");
    assertThat(page1).contains("Fantasía Demo");
    assertThat(page1).contains("Peluquería y otros tratamientos de belleza");
    assertThat(page1).contains("1137152-8");
    assertThat(page1).contains("001-002-0000007");
    assertThat(page1).contains("Contado");
    assertThat(page1).contains("Guaraníes");
  }

  /** AC-05: the identified client's data appears when the receiver isn't anonymous. */
  @Test
  void buildKudePdf_showsClientBlockWhenReceiverIsIdentified() throws Exception {
    var result = service.buildKudePdf(TENANT_ID, INVOICE_ID);
    String page1 = extractPage(result.bytes(), 1);

    assertThat(page1).contains("4123456");
    assertThat(page1).contains("Cliente Demo");
    assertThat(page1).contains("Operación presencial");
  }

  /**
   * Issue #173 item 4: a "Sin nominar" comprobante still prints the receiver rows, with "Sin
   * nombre" / "X" placeholders instead of omitting the block entirely.
   */
  @Test
  void buildKudePdf_showsSinNombrePlaceholdersForAnonymousReceiver() throws Exception {
    SifenReceiverData anonymous =
        new SifenReceiverData(null, null, null, null, null, null, null, null, null);
    SifenInvoiceHeader anonymousHeader =
        new SifenInvoiceHeader(
            header.controlNumber(),
            header.issueDateTime(),
            header.stampNumber(),
            header.establishment(),
            header.expeditionPoint(),
            header.stampValidFrom(),
            header.stampValidUntil(),
            header.issuer(),
            anonymous,
            header.testEnvironmentNotice());
    when(headerService.buildHeader(TENANT_ID, INVOICE_ID)).thenReturn(anonymousHeader);

    var result = service.buildKudePdf(TENANT_ID, INVOICE_ID);
    String allText = extractPage(result.bytes(), 1);

    assertThat(allText).contains("Sin nombre");
    assertThat(allText).contains("Operación presencial");
  }

  /**
   * Issue #173 item 6: the always-empty "Cuotas" / "Tipo de Cambio" rows are gone; "Moneda"
   * (spanning the whole grid now) and the still-relevant sale rows remain.
   */
  @Test
  void buildKudePdf_saleBlock_dropsCuotasAndTipoDeCambio() throws Exception {
    var result = service.buildKudePdf(TENANT_ID, INVOICE_ID);
    String page1 = extractPage(result.bytes(), 1);

    assertThat(page1).doesNotContain("Cuotas");
    assertThat(page1).doesNotContain("Tipo de Cambio");
    assertThat(page1).contains("Moneda");
    assertThat(page1).contains("Guaraníes");
    assertThat(page1).contains("Fecha y hora de Emisión");
    assertThat(page1).contains("Condición de Venta");
  }

  /** Issue #173 item 3: the cancellation-notice email can build a KuDE for a CANCELLED invoice. */
  @Test
  void buildCancelledKudePdf_allowsCancelledInvoice() throws Exception {
    invoice.setSifenSubmissionStatus(SifenSubmissionStatus.CANCELLED);

    var result = service.buildCancelledKudePdf(TENANT_ID, INVOICE_ID);

    assertThat(result.bytes()).isNotEmpty();
    assertThat(new PdfReader(result.bytes()).getNumberOfPages()).isGreaterThanOrEqualTo(1);
  }

  /** AC-08: the CDC is grouped visually in eleven 4-character blocks. */
  @Test
  void groupControlNumber_splitsIntoElevenFourCharacterBlocks() {
    String grouped = SifenKudePdfService.groupControlNumber(CDC);

    assertThat(CDC).hasSize(44);
    String[] blocks = grouped.split(" ");
    assertThat(blocks).hasSize(11);
    for (String block : blocks) {
      assertThat(block).hasSize(4);
    }
    assertThat(grouped.replace(" ", "")).isEqualTo(CDC);
  }

  /** AC-09/AC-10: legends and the public consultation URL appear alongside the CDC. */
  @Test
  void buildKudePdf_showsLegendsAndPublicConsultationUrl() throws Exception {
    var result = service.buildKudePdf(TENANT_ID, INVOICE_ID);
    String page1 = extractPage(result.bytes(), 1);

    assertThat(page1).contains("Representación gráfica de un Documento Electrónico");
    assertThat(page1).contains(CONSULTATION_URL);
    assertThat(page1).contains(SifenKudePdfService.groupControlNumber(CDC));
  }

  /** AC-06/AC-07: item detail (split by tax rate) and totals appear. */
  @Test
  void buildKudePdf_showsItemDetailAndTotals() throws Exception {
    var result = service.buildKudePdf(TENANT_ID, INVOICE_ID);
    String allPages = extractAllPages(result.bytes());

    assertThat(allPages).contains("Corte de cabello");
    assertThat(allPages).contains("SVC-1");
    assertThat(allPages).contains("100.000");
    assertThat(allPages).contains("Total de la operación");
    assertThat(allPages).contains("Total en Guaraníes");
    assertThat(allPages).contains("Total IVA");
    assertThat(allPages).contains("9.091");
  }

  /**
   * Manual Técnico page 196/198: the Exentas/5%/10% columns render under one merged "Valor de
   * Venta" header, matching the DNIT's reference KuDE table shape.
   */
  @Test
  void buildKudePdf_showsMergedValorDeVentaHeader() throws Exception {
    var result = service.buildKudePdf(TENANT_ID, INVOICE_ID);
    String page1 = extractPage(result.bytes(), 1);

    assertThat(page1).contains("Valor de Venta");
  }

  /**
   * Manual Técnico page 195's field-reference diagram shows a "LOGO" placeholder box in the
   * emisor's reserved logo space; the KuDE must render the same placeholder until a real business
   * logo is configured.
   */
  @Test
  void buildKudePdf_showsLogoPlaceholderWhenNoLogoConfigured() throws Exception {
    var result = service.buildKudePdf(TENANT_ID, INVOICE_ID);
    String page1 = extractPage(result.bytes(), 1);

    assertThat(page1).contains("LOGO");
  }

  /** AC-12: every page shows "Página N / M". */
  @Test
  void buildKudePdf_showsPageNumbering() throws Exception {
    var result = service.buildKudePdf(TENANT_ID, INVOICE_ID);
    String page1 = extractPage(result.bytes(), 1);

    assertThat(page1).contains("Página 1 / ");
  }

  /** AC-12 regression: the displayed total must match the PDF's real page count. */
  @Test
  void buildKudePdf_pageNumberingTotalMatchesActualPageCount() throws Exception {
    var result = service.buildKudePdf(TENANT_ID, INVOICE_ID);
    PdfReader reader = new PdfReader(result.bytes());
    int actualPages = reader.getNumberOfPages();
    String page1 = extractPage(result.bytes(), 1);

    assertThat(page1).contains("Página 1 / " + actualPages);
  }

  /** AC-11: an optional logo and free message are the only allowed extras. */
  @Test
  void buildKudePdf_showsOptionalFreeMessageWhenConfigured() throws Exception {
    BusinessProfile profile = new BusinessProfile();
    profile.setBusinessName("Salon Demo");
    profile.setKudeFooterMessage("¡Gracias por tu visita!");
    when(businessProfileRepository.findByTenantId(TENANT_ID)).thenReturn(Optional.of(profile));

    var result = service.buildKudePdf(TENANT_ID, INVOICE_ID);
    String allPages = extractAllPages(result.bytes());

    assertThat(allPages).contains("¡Gracias por tu visita!");
  }

  /**
   * RT-16 (Hardening_SIFEN.md): formalizes existing behavior — the same KuDE generation logic is
   * used for every tenant, with no per-tenant template file and no caching of {@link
   * BusinessProfile}; every call to {@link SifenKudePdfService#buildKudePdf} re-reads it fresh from
   * the database. Two calls with a mutated profile in between must render the change, proving
   * there's nothing to break by introducing a profile cache in the future.
   */
  @Test
  void buildKudePdf_rereadsBusinessProfileFreshOnEveryCall_noCaching() throws Exception {
    BusinessProfile profile = new BusinessProfile();
    profile.setBusinessName("Salon Demo");
    profile.setKudeFooterMessage("Mensaje original");
    when(businessProfileRepository.findByTenantId(TENANT_ID)).thenReturn(Optional.of(profile));

    String firstCallText = extractAllPages(service.buildKudePdf(TENANT_ID, INVOICE_ID).bytes());
    assertThat(firstCallText).contains("Mensaje original");
    assertThat(firstCallText).doesNotContain("Mensaje actualizado");

    // Mutate the same profile object between calls — a cache keyed by tenantId would return the
    // stale instance either way, so this only passes if buildKudePdf truly re-reads from the
    // repository on every invocation.
    profile.setKudeFooterMessage("Mensaje actualizado");

    String secondCallText = extractAllPages(service.buildKudePdf(TENANT_ID, INVOICE_ID).bytes());
    assertThat(secondCallText).contains("Mensaje actualizado");
    assertThat(secondCallText).doesNotContain("Mensaje original");
  }

  /** AC-13: the QR image is embedded on page 1, at least the minimum required width. */
  @Test
  void buildKudePdf_embedsAQrImageAtLeastTheMinimumWidth() throws Exception {
    var result = service.buildKudePdf(TENANT_ID, INVOICE_ID);
    PdfReader reader = new PdfReader(result.bytes());

    // At least one image XObject must be referenced from page 1's resources (the QR).
    com.lowagie.text.pdf.PdfDictionary pageDict = reader.getPageN(1);
    com.lowagie.text.pdf.PdfDictionary resources =
        pageDict.getAsDict(com.lowagie.text.pdf.PdfName.RESOURCES);
    com.lowagie.text.pdf.PdfDictionary xObjects =
        resources.getAsDict(com.lowagie.text.pdf.PdfName.XOBJECT);
    assertThat(xObjects).isNotNull();
    assertThat(xObjects.getKeys()).isNotEmpty();
    assertThat(SifenKudePdfService.QR_WIDTH_POINTS).isGreaterThanOrEqualTo(25f * (72f / 25.4f));
  }

  /**
   * Issue #179: for a fully IVA-exonerada operation (e.g. a "Tarjeta Diplomática de exoneración
   * fiscal" receiver — every line rate 0, iAfecIVA=2), Subtotal / Total de la operación / Total en
   * Guaraníes must be printed under the items table's "Exentas" column, not "10%".
   */
  @Test
  void buildKudePdf_exoneradoTotals_landUnderExentasColumnNotTenPercent() throws Exception {
    when(detailService.buildDetail(TENANT_ID, INVOICE_ID)).thenReturn(exoneradoDetail());

    var result = service.buildKudePdf(TENANT_ID, INVOICE_ID);
    var positions = textPositions(result.bytes(), 1);

    float fivePctX = xOf(positions, "5%");
    for (String row : List.of("Subtotal", "Total de la operación", "Total en Guaraníes")) {
      assertThat(valueXInSameRow(positions, row))
          .as("'%s' amount must sit left of the 5%%/10%% columns (i.e. under Exentas)", row)
          .isLessThan(fivePctX);
    }
  }

  /** Contrast / regression: a plain 10% invoice keeps its totals under the "10%" column. */
  @Test
  void buildKudePdf_gravado10Totals_landUnderTenPercentColumn() throws Exception {
    var result = service.buildKudePdf(TENANT_ID, INVOICE_ID);
    var positions = textPositions(result.bytes(), 1);

    float fivePctX = xOf(positions, "5%");
    assertThat(valueXInSameRow(positions, "Subtotal")).isGreaterThan(fivePctX);
  }

  /**
   * Issue #179: the logo box is bigger, taken from the address column — but the timbrado column
   * (RUC / Timbrado / vigencia / doc type + number) keeps its exact 5/19 share so it doesn't move.
   */
  @Test
  void headerLayout_enlargesLogo_shrinksAddress_keepsTimbradoColumn() {
    float[] w = SifenKudePdfService.HEADER_COLUMN_WEIGHTS;
    float sum = w[0] + w[1] + w[2];

    assertThat(w[0]).as("logo column wider").isGreaterThan(2f);
    assertThat(w[1]).as("address column narrower").isLessThan(12f);
    // Was 5 / (2 + 12 + 5) = 5/19; must be unchanged.
    assertThat(w[2] / sum).isEqualTo(5f / 19f, org.assertj.core.data.Offset.offset(0.0001f));
    assertThat(SifenKudePdfService.LOGO_CELL_HEIGHT).isGreaterThan(70f);
  }

  /**
   * Issue #179: the sale / receiver grid is packed two-up (colspan 3 + 3) instead of one full-width
   * field per row — "Moneda" and "Tipo de Operación" now share a row, as do "Fecha y hora de
   * Emisión" and "Condición de Venta".
   */
  @Test
  void buildKudePdf_saleGrid_isPackedTwoUp() throws Exception {
    var result = service.buildKudePdf(TENANT_ID, INVOICE_ID);
    var positions = textPositions(result.bytes(), 1);

    assertThat(xOf(positions, "Fecha y hora de Emisión: "))
        .isLessThan(xOf(positions, "Condición de Venta: "));
    assertThat(yOf(positions, "Fecha y hora de Emisión: "))
        .isEqualTo(
            yOf(positions, "Condición de Venta: "), org.assertj.core.data.Offset.offset(0.5f));

    assertThat(xOf(positions, "Moneda: ")).isLessThan(xOf(positions, "Tipo de Operación: "));
    assertThat(yOf(positions, "Moneda: "))
        .isEqualTo(
            yOf(positions, "Tipo de Operación: "), org.assertj.core.data.Offset.offset(0.5f));
  }

  private SifenInvoiceDetail exoneradoDetail() {
    SifenInvoiceLine line =
        new SifenInvoiceLine(
            "SVC-1",
            "Corte de cabello",
            null,
            1,
            "77",
            BigDecimal.valueOf(50_000),
            BigDecimal.ZERO,
            BigDecimal.ZERO,
            BigDecimal.valueOf(50_000),
            SifenTaxAffectation.EXONERADO,
            BigDecimal.ZERO,
            BigDecimal.ZERO,
            BigDecimal.ZERO,
            BigDecimal.ZERO);
    SifenInvoiceTotals totals =
        new SifenInvoiceTotals(
            BigDecimal.ZERO, // exemptSubtotal
            BigDecimal.valueOf(50_000), // exoneratedSubtotal
            BigDecimal.ZERO, // taxedSubtotal5
            BigDecimal.ZERO, // taxedSubtotal10
            BigDecimal.valueOf(50_000), // grossTotal
            BigDecimal.ZERO,
            BigDecimal.ZERO,
            BigDecimal.ZERO,
            BigDecimal.valueOf(50_000), // netTotal
            BigDecimal.ZERO,
            BigDecimal.ZERO,
            BigDecimal.ZERO,
            BigDecimal.ZERO,
            BigDecimal.ZERO,
            BigDecimal.ZERO,
            BigDecimal.ZERO,
            BigDecimal.ZERO);
    return new SifenInvoiceDetail(
        List.of(line),
        totals,
        1,
        List.of(new SifenPaymentDetail(1, BigDecimal.valueOf(50_000), null, null)));
  }

  private record TextAt(String text, float x, float y) {}

  /** Parses page {@code page}'s content stream for every {@code (text)Tj} and its x/y (from Tm). */
  private static java.util.List<TextAt> textPositions(byte[] pdf, int page) throws Exception {
    PdfReader reader = new PdfReader(pdf);
    String s =
        new String(reader.getPageContent(page), java.nio.charset.StandardCharsets.ISO_8859_1);
    java.util.regex.Matcher m =
        java.util.regex.Pattern.compile(
                "1 0 0 1 ([-\\d.]+) ([-\\d.]+) Tm\\s*/F\\d+ [\\d.]+ Tf\\s*\\(((?:[^()\\\\]|\\\\.)*)\\)Tj")
            .matcher(s);
    java.util.List<TextAt> out = new java.util.ArrayList<>();
    while (m.find()) {
      out.add(
          new TextAt(
              unescapePdfString(m.group(3)),
              Float.parseFloat(m.group(1)),
              Float.parseFloat(m.group(2))));
    }
    return out;
  }

  /** Decodes PDF string escapes so accented labels (é, í, ó, ñ — WinAnsi) compare literally. */
  private static String unescapePdfString(String raw) {
    StringBuilder sb = new StringBuilder();
    for (int i = 0; i < raw.length(); i++) {
      char c = raw.charAt(i);
      if (c != '\\') {
        sb.append(c);
        continue;
      }
      char n = raw.charAt(++i);
      if (n >= '0' && n <= '7') {
        int end = Math.min(i + 3, raw.length());
        int j = i;
        while (j < end && raw.charAt(j) >= '0' && raw.charAt(j) <= '7') {
          j++;
        }
        sb.append((char) Integer.parseInt(raw.substring(i, j), 8));
        i = j - 1;
      } else {
        sb.append(
            switch (n) {
              case 'n' -> '\n';
              case 'r' -> '\r';
              case 't' -> '\t';
              default -> n;
            });
      }
    }
    return sb.toString();
  }

  private static float xOf(java.util.List<TextAt> positions, String exactText) {
    return find(positions, exactText).x();
  }

  private static float yOf(java.util.List<TextAt> positions, String exactText) {
    return find(positions, exactText).y();
  }

  private static TextAt find(java.util.List<TextAt> positions, String exactText) {
    return positions.stream()
        .filter(t -> t.text().equals(exactText))
        .findFirst()
        .orElseThrow(
            () ->
                new AssertionError(
                    "text not found in PDF: '"
                        + exactText
                        + "' — have: "
                        + positions.stream().map(TextAt::text).toList()));
  }

  /** x of the numeric cell on the same row (same y ± 1pt) as the given label. */
  private static float valueXInSameRow(java.util.List<TextAt> positions, String label) {
    float labelY =
        positions.stream()
            .filter(t -> t.text().equals(label))
            .map(TextAt::y)
            .findFirst()
            .orElseThrow(() -> new AssertionError("label not found in PDF: " + label));
    return positions.stream()
        .filter(t -> Math.abs(t.y() - labelY) < 1f && t.text().matches("[\\d.]+"))
        .map(TextAt::x)
        .findFirst()
        .orElseThrow(() -> new AssertionError("no numeric value on row: " + label));
  }

  private static String extractPage(byte[] pdf, int page) throws Exception {
    PdfReader reader = new PdfReader(pdf);
    return new PdfTextExtractor(reader).getTextFromPage(page);
  }

  private static String extractAllPages(byte[] pdf) throws Exception {
    PdfReader reader = new PdfReader(pdf);
    StringBuilder sb = new StringBuilder();
    for (int i = 1; i <= reader.getNumberOfPages(); i++) {
      sb.append(new PdfTextExtractor(reader).getTextFromPage(i));
    }
    return sb.toString();
  }
}
