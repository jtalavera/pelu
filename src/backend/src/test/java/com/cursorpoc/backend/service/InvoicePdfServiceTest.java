package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
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
import com.cursorpoc.backend.repository.BusinessProfileRepository;
import com.cursorpoc.backend.repository.InvoiceRepository;
import com.lowagie.text.pdf.PdfReader;
import com.lowagie.text.pdf.parser.PdfTextExtractor;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;

class InvoicePdfServiceTest {

  private InvoicePdfService newService() {
    FemmeTimeProperties time = new FemmeTimeProperties();
    return new InvoicePdfService(
        mock(BusinessProfileRepository.class),
        mock(InvoiceRepository.class),
        mock(BusinessProfileService.class),
        time);
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
}
