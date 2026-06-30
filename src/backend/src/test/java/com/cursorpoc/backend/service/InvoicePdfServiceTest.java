package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.FiscalStamp;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.InvoiceLine;
import com.cursorpoc.backend.domain.InvoicePaymentAllocation;
import com.cursorpoc.backend.domain.SalonService;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.DiscountType;
import com.cursorpoc.backend.domain.enums.InvoiceStatus;
import com.cursorpoc.backend.domain.enums.PaymentMethod;
import com.cursorpoc.backend.repository.InvoiceRepository;
import com.lowagie.text.pdf.PdfReader;
import com.lowagie.text.pdf.parser.PdfTextExtractor;
import java.io.ByteArrayInputStream;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.InflaterInputStream;
import org.junit.jupiter.api.Test;

class InvoicePdfServiceTest {

  private InvoicePdfService newService() {
    FemmeTimeProperties time = new FemmeTimeProperties();
    return new InvoicePdfService(
        mock(InvoiceRepository.class), mock(BusinessProfileService.class), time);
  }

  private Invoice baseInvoice(List<InvoiceLine> lines, List<InvoicePaymentAllocation> payments) {
    Tenant tenant = new Tenant();
    tenant.setId(1L);
    FiscalStamp stamp = new FiscalStamp();
    stamp.setStampNumber("SET-1");
    stamp.setValidFrom(LocalDate.of(2025, 8, 12));
    stamp.setValidUntil(LocalDate.of(2026, 8, 31));

    Invoice invoice = mock(Invoice.class);
    when(invoice.getTenant()).thenReturn(tenant);
    when(invoice.getFiscalStamp()).thenReturn(stamp);
    when(invoice.getInvoiceNumber()).thenReturn(7);
    when(invoice.getIssuedAt()).thenReturn(Instant.parse("2026-04-07T12:00:00Z"));
    when(invoice.getLines()).thenReturn(lines);
    when(invoice.getPaymentAllocations()).thenReturn(payments);
    when(invoice.getSubtotal()).thenReturn(new BigDecimal("100.00"));
    when(invoice.getTotal()).thenReturn(new BigDecimal("100.00"));
    when(invoice.getDiscountType()).thenReturn(DiscountType.NONE);
    when(invoice.getDiscountValue()).thenReturn(null);
    when(invoice.getClientDisplayName()).thenReturn("Client");
    when(invoice.getClientRucOverride()).thenReturn(null);
    when(invoice.getStatus()).thenReturn(InvoiceStatus.ISSUED);
    return invoice;
  }

  private static String extractText(byte[] pdf) throws Exception {
    PdfReader reader = new PdfReader(pdf);
    try {
      PdfTextExtractor extractor = new PdfTextExtractor(reader);
      StringBuilder out = new StringBuilder();
      for (int i = 1; i <= reader.getNumberOfPages(); i++) {
        out.append(extractor.getTextFromPage(i)).append('\n');
      }
      return out.toString();
    } finally {
      reader.close();
    }
  }

  // ─── Coordinate helpers ───────────────────────────────────────────────────

  /**
   * Decompresses the first FlateDecode content stream found in the PDF bytes and returns it as a
   * Latin-1 string (PDF content streams are binary-safe with Latin-1).
   */
  static String decodePdfContentStream(byte[] pdf) throws Exception {
    // Find "stream\n" or "stream\r\n" boundary
    byte[] lf = "stream\n".getBytes(StandardCharsets.US_ASCII);
    byte[] crlf = "stream\r\n".getBytes(StandardCharsets.US_ASCII);
    int start = indexOf(pdf, lf, 0);
    int headerLen = lf.length;
    if (start < 0) {
      start = indexOf(pdf, crlf, 0);
      headerLen = crlf.length;
    }
    if (start < 0) throw new IllegalStateException("No stream marker found in PDF");
    int contentStart = start + headerLen;

    // Find "endstream" boundary
    byte[] end = "endstream".getBytes(StandardCharsets.US_ASCII);
    int contentEnd = indexOf(pdf, end, contentStart);
    if (contentEnd < 0) throw new IllegalStateException("No endstream marker found in PDF");

    byte[] compressed = java.util.Arrays.copyOfRange(pdf, contentStart, contentEnd);
    try (InflaterInputStream iis = new InflaterInputStream(new ByteArrayInputStream(compressed))) {
      return new String(iis.readAllBytes(), StandardCharsets.ISO_8859_1);
    }
  }

  private static int indexOf(byte[] haystack, byte[] needle, int from) {
    outer:
    for (int i = from; i <= haystack.length - needle.length; i++) {
      for (int j = 0; j < needle.length; j++) {
        if (haystack[i + j] != needle[j]) continue outer;
      }
      return i;
    }
    return -1;
  }

  /**
   * Finds all occurrences of {@code searchText} in the PDF content stream and returns a list of [x,
   * y] float arrays representing the text-matrix position at which each occurrence was drawn.
   *
   * <p>Matches the PDF operator sequence: {@code a b c d x y Tm ... (searchText)Tj}.
   */
  static List<float[]> findTextPositions(byte[] pdf, String searchText) throws Exception {
    String stream = decodePdfContentStream(pdf);
    List<float[]> positions = new ArrayList<>();
    // The Tm text-matrix operator: 6 numbers followed by "Tm", then optional font/color ops
    // (which never contain "("), then the text string "(searchText)Tj".
    // Using [^(]* instead of .*? ensures we capture the Tm immediately before searchText, not an
    // earlier Tm in the same BT block. PDF text strings are the only constructs using "(" in
    // content streams, so [^(]* stops exactly at the intended text.
    Pattern p =
        Pattern.compile(
            "[-0-9.]+ [-0-9.]+ [-0-9.]+ [-0-9.]+ ([-0-9.]+) ([-0-9.]+) Tm[^(]*\\("
                + Pattern.quote(searchText)
                + "\\)Tj");
    Matcher m = p.matcher(stream);
    while (m.find()) {
      positions.add(new float[] {Float.parseFloat(m.group(1)), Float.parseFloat(m.group(2))});
    }
    return positions;
  }

  // ─── Existing functional tests ────────────────────────────────────────────

  /** HU-26: invoice number removed from PDF header. */
  @Test
  void renderPdf_isValidAndDoesNotContainInvoiceNumber() throws Exception {
    InvoicePdfService svc = newService();

    InvoiceLine line = new InvoiceLine();
    line.setDescription("Service A");
    line.setQuantity(1);
    line.setUnitPrice(new BigDecimal("100.00"));
    line.setLineTotal(new BigDecimal("100.00"));

    Invoice invoice = baseInvoice(List.of(line), List.of());

    byte[] pdf = svc.renderPdf(invoice);
    assertThat(pdf.length).isGreaterThan(200);
    assertThat(pdf).startsWith("%PDF".getBytes(StandardCharsets.US_ASCII));

    String text = extractText(pdf);
    assertThat(text).doesNotContain("0000007");
    assertThat(text).contains("Client");
    assertThat(text).contains("Service A");
  }

  /** HU-21: timbrado number, validity dates and copy footers must not appear in the PDF. */
  @Test
  void renderPdf_omitsTimbradoValidityAndCopyLabels() throws Exception {
    InvoicePdfService svc = newService();

    InvoiceLine line = new InvoiceLine();
    line.setDescription("Service A");
    line.setQuantity(1);
    line.setUnitPrice(new BigDecimal("100.00"));
    line.setLineTotal(new BigDecimal("100.00"));

    Invoice invoice = baseInvoice(List.of(line), List.of());
    byte[] pdf = svc.renderPdf(invoice);
    String text = extractText(pdf);

    // Timbrado / vigencia removed
    assertThat(text).doesNotContain("Timbrado");
    assertThat(text).doesNotContain("Vigencia");
    assertThat(text).doesNotContain("SET-1");
    assertThat(text).doesNotContain("12/08/2025");
    assertThat(text).doesNotContain("31/08/2026");
    // Column headers removed
    assertThat(text).doesNotContain("Cant.");
    assertThat(text).doesNotContain("Descripción");
    assertThat(text).doesNotContain("P. unit.");
    assertThat(text).doesNotContain("10%");
    // Copy designation removed
    assertThat(text).doesNotContain("COPIA");
    assertThat(text).doesNotContain("ORIGINAL");
    assertThat(text).doesNotContain("ADQUIRENTE");
    assertThat(text).doesNotContain("ARCHIVO TRIBUTARIO");
  }

  /** HU-21: payment method short labels (Efec./Deb./Cred./Transf./Otro) must not appear. */
  @Test
  void renderPdf_omitsPaymentMethodShortLabels() throws Exception {
    InvoicePdfService svc = newService();

    InvoiceLine line = new InvoiceLine();
    line.setDescription("Service A");
    line.setQuantity(1);
    line.setUnitPrice(new BigDecimal("100.00"));
    line.setLineTotal(new BigDecimal("100.00"));

    InvoicePaymentAllocation cash = mock(InvoicePaymentAllocation.class);
    when(cash.getMethod()).thenReturn(PaymentMethod.CASH);
    when(cash.getAmount()).thenReturn(new BigDecimal("100.00"));

    Invoice invoice = baseInvoice(List.of(line), List.of(cash));
    byte[] pdf = svc.renderPdf(invoice);
    String text = extractText(pdf);

    assertThat(text).doesNotContain("Efec.");
    assertThat(text).doesNotContain("Deb.");
    assertThat(text).doesNotContain("Cred.");
    assertThat(text).doesNotContain("Transf.");
    assertThat(text).doesNotContain("Otro");
  }

  // ─── HU-29 AC5/AC6: tax columns and discount lines ──────────────────────────

  private static InvoiceLine line(
      String desc,
      int qty,
      String unitPrice,
      String taxRate,
      DiscountType discType,
      String discValue,
      String lineTotal) {
    InvoiceLine l = new InvoiceLine();
    l.setDescription(desc);
    l.setQuantity(qty);
    l.setUnitPrice(new BigDecimal(unitPrice));
    l.setTaxRate(taxRate == null ? null : new BigDecimal(taxRate));
    l.setDiscountType(discType);
    l.setDiscountValue(discValue == null ? null : new BigDecimal(discValue));
    l.setLineTotal(new BigDecimal(lineTotal));
    return l;
  }

  @Test
  void taxColumnIndex_mapsRatesToColumns() {
    assertThat(InvoicePdfService.taxColumnIndex(new BigDecimal("10.0000"))).isEqualTo(2);
    assertThat(InvoicePdfService.taxColumnIndex(new BigDecimal("5.0000"))).isEqualTo(1);
    assertThat(InvoicePdfService.taxColumnIndex(new BigDecimal("0.0000"))).isEqualTo(0);
    assertThat(InvoicePdfService.taxColumnIndex(null)).isEqualTo(0);
  }

  /** AC5: each item's gross total lands in the column matching its tax rate. */
  @Test
  void buildDetailRows_placesGrossInTaxColumnByRate() {
    InvoiceLine exenta = line("Exenta item", 2, "1000", "0", DiscountType.NONE, null, "2000");
    InvoiceLine iva5 = line("IVA5 item", 1, "5000", "5", DiscountType.NONE, null, "5000");
    InvoiceLine iva10 = line("IVA10 item", 3, "1000", "10", DiscountType.NONE, null, "3000");

    Invoice invoice = mock(Invoice.class);
    when(invoice.getLines()).thenReturn(List.of(exenta, iva5, iva10));
    when(invoice.getSubtotal()).thenReturn(new BigDecimal("10000"));
    when(invoice.getTotal()).thenReturn(new BigDecimal("10000"));
    when(invoice.getDiscountType()).thenReturn(DiscountType.NONE);

    List<InvoicePdfService.DetailRow> rows = InvoicePdfService.buildDetailRows(invoice);
    assertThat(rows).hasSize(3);
    // Exenta → column 0
    assertThat(rows.get(0).columnAmounts()[0]).isEqualByComparingTo("2000");
    assertThat(rows.get(0).columnAmounts()[1]).isNull();
    assertThat(rows.get(0).columnAmounts()[2]).isNull();
    // IVA 5% → column 1
    assertThat(rows.get(1).columnAmounts()[1]).isEqualByComparingTo("5000");
    // IVA 10% → column 2
    assertThat(rows.get(2).columnAmounts()[2]).isEqualByComparingTo("3000");
  }

  /** AC6: a per-item discount adds a second row with the negative discount in the same column. */
  @Test
  void buildDetailRows_addsNegativeDiscountRowInSameColumn() {
    // Gross 10000, 10% discount → lineTotal 9000, discount 1000, tax column = IVA 10% (index 2)
    InvoiceLine l = line("Corte", 1, "10000", "10", DiscountType.PERCENT, "10", "9000");
    Invoice invoice = mock(Invoice.class);
    when(invoice.getLines()).thenReturn(List.of(l));
    when(invoice.getSubtotal()).thenReturn(new BigDecimal("9000"));
    when(invoice.getTotal()).thenReturn(new BigDecimal("9000"));
    when(invoice.getDiscountType()).thenReturn(DiscountType.NONE);

    List<InvoicePdfService.DetailRow> rows = InvoicePdfService.buildDetailRows(invoice);
    assertThat(rows).hasSize(2);
    // Item row: gross in column 2
    assertThat(rows.get(0).quantity()).isEqualTo(1);
    assertThat(rows.get(0).columnAmounts()[2]).isEqualByComparingTo("10000");
    // Discount row: no qty/unit price, negative discount in the same column, descriptive label
    assertThat(rows.get(1).quantity()).isNull();
    assertThat(rows.get(1).unitPrice()).isNull();
    assertThat(rows.get(1).columnAmounts()[2]).isEqualByComparingTo("-1000");
    assertThat(rows.get(1).description()).contains("Corte").contains("Dto.");
  }

  /**
   * AC6: the global discount is split negatively across columns and sums exactly to the discount.
   */
  @Test
  void buildDetailRows_distributesGlobalDiscountAcrossColumns() {
    InvoiceLine iva5 = line("A", 1, "4000", "5", DiscountType.NONE, null, "4000");
    InvoiceLine iva10 = line("B", 1, "6000", "10", DiscountType.NONE, null, "6000");
    Invoice invoice = mock(Invoice.class);
    when(invoice.getLines()).thenReturn(List.of(iva5, iva10));
    when(invoice.getSubtotal()).thenReturn(new BigDecimal("10000"));
    when(invoice.getTotal()).thenReturn(new BigDecimal("9000")); // global discount 1000
    when(invoice.getDiscountType()).thenReturn(DiscountType.FIXED);
    when(invoice.getDiscountValue()).thenReturn(new BigDecimal("1000"));

    List<InvoicePdfService.DetailRow> rows = InvoicePdfService.buildDetailRows(invoice);
    // 2 item rows + 1 global discount row
    assertThat(rows).hasSize(3);
    InvoicePdfService.DetailRow global = rows.get(2);
    assertThat(global.description()).contains("global");
    BigDecimal sum = BigDecimal.ZERO;
    for (int c = 0; c < 3; c++) {
      if (global.columnAmounts()[c] != null) {
        sum = sum.add(global.columnAmounts()[c]);
      }
    }
    assertThat(sum).isEqualByComparingTo("-1000");
    // 40/60 split of 1000 → 400 / 600
    assertThat(global.columnAmounts()[1]).isEqualByComparingTo("-400");
    assertThat(global.columnAmounts()[2]).isEqualByComparingTo("-600");
  }

  @Test
  void distributeGlobalDiscount_handlesRoundingRemainder() {
    BigDecimal[] net = {BigDecimal.ZERO, new BigDecimal("1"), new BigDecimal("2")};
    BigDecimal[] out = InvoicePdfService.distributeGlobalDiscount(new BigDecimal("10"), net);
    BigDecimal sum =
        (out[0] == null ? BigDecimal.ZERO : out[0])
            .add(out[1] == null ? BigDecimal.ZERO : out[1])
            .add(out[2] == null ? BigDecimal.ZERO : out[2]);
    assertThat(sum).isEqualByComparingTo("-10");
  }

  /** AC6 smoke test: per-item discount line text is rendered into the PDF. */
  @Test
  void renderPdf_printsDiscountLine() throws Exception {
    InvoicePdfService svc = newService();
    InvoiceLine l = line("Corte premium", 1, "100", "10", DiscountType.PERCENT, "10", "90");

    Invoice invoice = baseInvoice(List.of(l), List.of());
    when(invoice.getSubtotal()).thenReturn(new BigDecimal("90.00"));
    when(invoice.getTotal()).thenReturn(new BigDecimal("90.00"));

    byte[] pdf = svc.renderPdf(invoice);
    String text = extractText(pdf);
    assertThat(text).contains("Dto.");
  }

  /** Issue #55: the PDF must contain the grand total spelled out in Spanish. */
  @Test
  void renderPdf_containsAmountInWords() throws Exception {
    InvoicePdfService svc = newService();

    InvoiceLine line = new InvoiceLine();
    line.setDescription("Corte");
    line.setQuantity(1);
    line.setUnitPrice(new BigDecimal("150000"));
    line.setLineTotal(new BigDecimal("150000"));

    Invoice invoice = baseInvoice(List.of(line), List.of());
    when(invoice.getSubtotal()).thenReturn(new BigDecimal("150000"));
    when(invoice.getTotal()).thenReturn(new BigDecimal("150000"));

    byte[] pdf = svc.renderPdf(invoice);
    String text = extractText(pdf);
    // "ciento cincuenta mil guaraníes" must appear on both copies (two panels)
    assertThat(text).contains("ciento cincuenta mil");
  }

  @Test
  void lineDescriptionForPrint_usesServiceNameWhenLinked() {
    SalonService svc = new SalonService();
    svc.setName("Corte premium");
    InvoiceLine line = new InvoiceLine();
    line.setDescription("Texto factura distinto");
    line.setSalonService(svc);
    assertThat(InvoicePdfService.lineDescriptionForPrint(line)).isEqualTo("Corte premium");
  }

  @Test
  void lineDescriptionForPrint_fallsBackToDescriptionWhenNoService() {
    InvoiceLine line = new InvoiceLine();
    line.setDescription("Ítem manual");
    line.setSalonService(null);
    assertThat(InvoicePdfService.lineDescriptionForPrint(line)).isEqualTo("Ítem manual");
  }

  // ─── Layout / coordinate tests (calibrated to factura_vieja_femme.pdf) ────

  /**
   * The generated PDF must use the 756×424 pt page size matching factura_vieja_femme.pdf (MediaBox
   * [0 0 424 756] + /Rotate 90 ≈ 26.67×14.96 cm landscape).
   */
  @Test
  void renderPdf_pageSizeIs756x424() throws Exception {
    byte[] pdf = newService().renderPdf(baseInvoice(List.of(singleLine()), List.of()));
    PdfReader reader = new PdfReader(pdf);
    try {
      com.lowagie.text.Rectangle size = reader.getPageSize(1);
      assertThat((double) size.getWidth()).isCloseTo(756.0, within(1.0));
      assertThat((double) size.getHeight()).isCloseTo(424.0, within(1.0));
    } finally {
      reader.close();
    }
  }

  /**
   * Left-panel fields must be drawn at the absolute coordinates measured from
   * factura_vieja_femme.pdf (±1 pt tolerance).
   */
  @Test
  void renderPdf_leftPanelCoordinatesMatchReference() throws Exception {
    InvoicePdfService svc = newService();
    InvoiceLine item = new InvoiceLine();
    item.setDescription("Corte");
    item.setQuantity(2);
    item.setUnitPrice(new BigDecimal("50000"));
    item.setLineTotal(new BigDecimal("100000"));
    item.setTaxRate(new BigDecimal("10.0000"));

    Invoice invoice = baseInvoice(List.of(item), List.of());
    when(invoice.getClientRucOverride()).thenReturn("80000005-6");
    when(invoice.getClientDisplayName()).thenReturn("Ana Garcia");
    when(invoice.getSubtotal()).thenReturn(new BigDecimal("100000"));
    when(invoice.getTotal()).thenReturn(new BigDecimal("100000"));

    byte[] pdf = svc.renderPdf(invoice);

    // RUC — LEFT-aligned at (L_X_RUC=24, L_Y_RUC=320.7)
    List<float[]> rucPos = findTextPositions(pdf, "80000005-6");
    assertThat(rucPos).hasSizeGreaterThanOrEqualTo(2); // two panels
    assertThat((double) rucPos.get(0)[0]).isCloseTo(InvoicePdfService.L_X_RUC, within(1.0));
    assertThat((double) rucPos.get(0)[1]).isCloseTo(InvoicePdfService.L_Y_RUC, within(1.0));

    // Name — LEFT-aligned at (L_X_NAME=80, L_Y_NAME=309.7)
    List<float[]> namePos = findTextPositions(pdf, "Ana Garcia");
    assertThat(namePos).hasSizeGreaterThanOrEqualTo(2);
    assertThat((double) namePos.get(0)[0]).isCloseTo(InvoicePdfService.L_X_NAME, within(1.0));
    assertThat((double) namePos.get(0)[1]).isCloseTo(InvoicePdfService.L_Y_NAME, within(1.0));

    // Quantity — LEFT-aligned at (L_X_QTY=25.11, TABLE_FIRST_ROW_Y=256.54)
    List<float[]> qtyPos = findTextPositions(pdf, "2");
    assertThat(qtyPos).isNotEmpty();
    assertThat((double) qtyPos.get(0)[0]).isCloseTo(InvoicePdfService.L_X_QTY, within(1.0));
    assertThat((double) qtyPos.get(0)[1])
        .isCloseTo(InvoicePdfService.TABLE_FIRST_ROW_Y, within(1.0));

    // IVA-10% column amount for the item (qty=2, unit=50.000 → gross=100.000)
    // LEFT-aligned at (L_X_TAX_COL10=254, TABLE_FIRST_ROW_Y=256.54)
    List<float[]> taxAmtPos = findTextPositions(pdf, "100.000");
    // First two occurrences are the detail-row amounts on left/right panels
    assertThat(taxAmtPos).hasSizeGreaterThanOrEqualTo(1);
    // Find the one at the left panel detail-row position
    boolean foundDetailLeft =
        taxAmtPos.stream()
            .anyMatch(
                p ->
                    Math.abs(p[0] - InvoicePdfService.L_X_TAX_COL10) < 1.5
                        && Math.abs(p[1] - InvoicePdfService.TABLE_FIRST_ROW_Y) < 1.5);
    assertThat(foundDetailLeft)
        .as("IVA-10% amount should appear at left panel detail row x=254, y=256.54")
        .isTrue();

    // Subtotal — LEFT-aligned at (L_X_TAX_COL10=254, L_Y_SUBTOTALS=114.7)
    List<float[]> subtotalPos = findTextPositions(pdf, "100.000");
    boolean foundSubtotalLeft =
        subtotalPos.stream()
            .anyMatch(
                p ->
                    Math.abs(p[0] - InvoicePdfService.L_X_TAX_COL10) < 1.5
                        && Math.abs(p[1] - InvoicePdfService.L_Y_SUBTOTALS) < 1.5);
    assertThat(foundSubtotalLeft)
        .as("Subtotal should appear at left panel subtotals position x=254, y=114.7")
        .isTrue();

    // Amount in words — LEFT-aligned at (L_X_WORDS=1, L_Y_WORDS=86.87)
    String words = SpanishNumberToWords.guaranies(new BigDecimal("100000"));
    List<float[]> wordsPos = findTextPositions(pdf, words);
    assertThat(wordsPos).hasSizeGreaterThanOrEqualTo(2);
    assertThat((double) wordsPos.get(0)[0]).isCloseTo(InvoicePdfService.L_X_WORDS, within(1.0));
    assertThat((double) wordsPos.get(0)[1]).isCloseTo(InvoicePdfService.L_Y_WORDS, within(1.0));
  }

  /**
   * Right-panel fields must be drawn at the absolute coordinates measured from
   * factura_vieja_femme.pdf (±1 pt tolerance).
   */
  @Test
  void renderPdf_rightPanelCoordinatesMatchReference() throws Exception {
    InvoicePdfService svc = newService();
    InvoiceLine item = new InvoiceLine();
    item.setDescription("Lavado");
    item.setQuantity(1);
    item.setUnitPrice(new BigDecimal("40000"));
    item.setLineTotal(new BigDecimal("40000"));
    item.setTaxRate(new BigDecimal("10.0000"));

    Invoice invoice = baseInvoice(List.of(item), List.of());
    when(invoice.getClientRucOverride()).thenReturn("3656517-2");
    when(invoice.getClientDisplayName()).thenReturn("Maria Lopez");
    when(invoice.getSubtotal()).thenReturn(new BigDecimal("40000"));
    when(invoice.getTotal()).thenReturn(new BigDecimal("40000"));

    byte[] pdf = svc.renderPdf(invoice);

    // RUC — right panel at (R_X_RUC=353, R_Y_RUC=321.7)
    List<float[]> rucPos = findTextPositions(pdf, "3656517-2");
    assertThat(rucPos).hasSizeGreaterThanOrEqualTo(2);
    assertThat((double) rucPos.get(1)[0]).isCloseTo(InvoicePdfService.R_X_RUC, within(1.0));
    assertThat((double) rucPos.get(1)[1]).isCloseTo(InvoicePdfService.R_Y_RUC, within(1.0));

    // Name — right panel at (R_X_NAME=400, R_Y_NAME=307.7)
    List<float[]> namePos = findTextPositions(pdf, "Maria Lopez");
    assertThat(namePos).hasSizeGreaterThanOrEqualTo(2);
    assertThat((double) namePos.get(1)[0]).isCloseTo(InvoicePdfService.R_X_NAME, within(1.0));
    assertThat((double) namePos.get(1)[1]).isCloseTo(InvoicePdfService.R_Y_NAME, within(1.0));

    // Qty — right panel LEFT-aligned at (R_X_QTY=314, TABLE_FIRST_ROW_Y=256.54)
    List<float[]> qtyPos = findTextPositions(pdf, "1");
    assertThat(qtyPos).isNotEmpty();
    boolean foundQtyRight =
        qtyPos.stream()
            .anyMatch(
                p ->
                    Math.abs(p[0] - InvoicePdfService.R_X_QTY) < 1.5
                        && Math.abs(p[1] - InvoicePdfService.TABLE_FIRST_ROW_Y) < 1.5);
    assertThat(foundQtyRight).as("Quantity should appear at right panel x=314, y=256.54").isTrue();

    // Description — right panel LEFT at (R_X_DESC=339, TABLE_FIRST_ROW_Y=256.54)
    List<float[]> descPos = findTextPositions(pdf, "Lavado");
    assertThat(descPos).hasSizeGreaterThanOrEqualTo(2);
    assertThat((double) descPos.get(1)[0]).isCloseTo(InvoicePdfService.R_X_DESC, within(1.0));
    assertThat((double) descPos.get(1)[1])
        .isCloseTo(InvoicePdfService.TABLE_FIRST_ROW_Y, within(1.0));

    // Unit price — right panel LEFT at (R_X_UNIT=434, TABLE_FIRST_ROW_Y=256.54)
    List<float[]> unitPos = findTextPositions(pdf, "40.000");
    boolean foundUnitRight =
        unitPos.stream()
            .anyMatch(
                p ->
                    Math.abs(p[0] - InvoicePdfService.R_X_UNIT) < 1.5
                        && Math.abs(p[1] - InvoicePdfService.TABLE_FIRST_ROW_Y) < 1.5);
    assertThat(foundUnitRight)
        .as("Unit price should appear at right panel x=434, y=256.54")
        .isTrue();

    // IVA-10% amount — right panel LEFT at (R_X_TAX_COL10=554, TABLE_FIRST_ROW_Y=256.54)
    boolean foundTaxRight =
        unitPos.stream()
            .anyMatch(
                p ->
                    Math.abs(p[0] - InvoicePdfService.R_X_TAX_COL10) < 1.5
                        && Math.abs(p[1] - InvoicePdfService.TABLE_FIRST_ROW_Y) < 1.5);
    assertThat(foundTaxRight)
        .as("IVA-10% amount should appear at right panel x=554, y=256.54")
        .isTrue();

    // Amount in words — right panel at (R_X_WORDS=351, R_Y_WORDS=84.87)
    String words = SpanishNumberToWords.guaranies(new BigDecimal("40000"));
    List<float[]> wordsPos = findTextPositions(pdf, words);
    assertThat(wordsPos).hasSizeGreaterThanOrEqualTo(2);
    assertThat((double) wordsPos.get(1)[0]).isCloseTo(InvoicePdfService.R_X_WORDS, within(1.0));
    assertThat((double) wordsPos.get(1)[1]).isCloseTo(InvoicePdfService.R_Y_WORDS, within(1.0));
  }

  /**
   * Phone numbers must not be drawn in the PDF. The reference form (factura_vieja_femme.pdf) does
   * not include a client phone field.
   */
  @Test
  void renderPdf_doesNotDrawClientPhone() throws Exception {
    com.cursorpoc.backend.domain.Client client = new com.cursorpoc.backend.domain.Client();
    client.setPhone("0981-123456");

    InvoiceLine item = singleLine();

    Invoice invoice = baseInvoice(List.of(item), List.of());
    when(invoice.getClient()).thenReturn(client);

    byte[] pdf = newService().renderPdf(invoice);
    String text = extractText(pdf);
    assertThat(text).doesNotContain("0981-123456");
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private static InvoiceLine singleLine() {
    InvoiceLine line = new InvoiceLine();
    line.setDescription("Service A");
    line.setQuantity(1);
    line.setUnitPrice(new BigDecimal("100.00"));
    line.setLineTotal(new BigDecimal("100.00"));
    return line;
  }
}
