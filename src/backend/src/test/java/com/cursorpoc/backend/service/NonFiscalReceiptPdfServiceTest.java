package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.BusinessProfile;
import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.domain.FiscalStamp;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.InvoiceLine;
import com.cursorpoc.backend.domain.InvoicePaymentAllocation;
import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.CardBrand;
import com.cursorpoc.backend.domain.enums.DiscountType;
import com.cursorpoc.backend.domain.enums.InvoiceStatus;
import com.cursorpoc.backend.domain.enums.PaymentMethod;
import com.cursorpoc.backend.repository.BusinessProfileRepository;
import com.cursorpoc.backend.repository.InvoiceRepository;
import com.lowagie.text.pdf.PdfDictionary;
import com.lowagie.text.pdf.PdfName;
import com.lowagie.text.pdf.PdfReader;
import com.lowagie.text.pdf.parser.PdfTextExtractor;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

/** Comprobante NO fiscal (A4 and 80 mm ticket): content, formats, logo and gating rules. */
class NonFiscalReceiptPdfServiceTest {

  /** A 1×1 PNG, enough for the logo cell. */
  private static final String LOGO_DATA_URL =
      "data:image/png;base64,"
          + "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  private final FeatureFlagService flags = mock(FeatureFlagService.class);
  private final InvoiceRepository invoices = mock(InvoiceRepository.class);
  private final BusinessProfileRepository profiles = mock(BusinessProfileRepository.class);

  private NonFiscalReceiptPdfService service() {
    return new NonFiscalReceiptPdfService(invoices, profiles, new FemmeTimeProperties(), flags);
  }

  private static BusinessProfile profile(String logo) {
    BusinessProfile bp = mock(BusinessProfile.class);
    when(bp.getBusinessName()).thenReturn("Salón Demo");
    when(bp.getRuc()).thenReturn("80099999-1");
    when(bp.getAddress()).thenReturn("Av. Mariscal López 1234, Asunción");
    when(bp.getPhone()).thenReturn("0981 555 000");
    when(bp.getContactEmail()).thenReturn("contacto@salon-demo.example.com");
    when(bp.getLogoDataUrl()).thenReturn(logo);
    when(bp.getKudeFooterMessage()).thenReturn("¡Gracias por tu visita!");
    return bp;
  }

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
    l.setTaxAmount(taxRate == null ? null : BigDecimal.ZERO);
    l.setDiscountType(discType);
    l.setDiscountValue(discValue == null ? null : new BigDecimal(discValue));
    l.setLineTotal(new BigDecimal(lineTotal));
    return l;
  }

  private static InvoicePaymentAllocation payment(PaymentMethod method, String amount) {
    InvoicePaymentAllocation a = mock(InvoicePaymentAllocation.class);
    when(a.getMethod()).thenReturn(method);
    when(a.getAmount()).thenReturn(new BigDecimal(amount));
    return a;
  }

  private static Invoice invoice(
      List<InvoiceLine> lines,
      List<InvoicePaymentAllocation> payments,
      String subtotal,
      String total) {
    Tenant tenant = new Tenant();
    tenant.setId(1L);
    tenant.setName("Tenant");
    FiscalStamp stamp = new FiscalStamp();
    stamp.setStampNumber("12345678");
    stamp.setEstablishment(1);
    stamp.setExpeditionPoint(1);
    stamp.setValidFrom(LocalDate.of(2025, 8, 12));

    Invoice invoice = mock(Invoice.class);
    when(invoice.getTenant()).thenReturn(tenant);
    when(invoice.getFiscalStamp()).thenReturn(stamp);
    when(invoice.getInvoiceNumber()).thenReturn(123);
    when(invoice.getIssuedAt()).thenReturn(Instant.parse("2026-04-07T12:00:00Z"));
    when(invoice.getLines()).thenReturn(lines);
    when(invoice.getPaymentAllocations()).thenReturn(payments);
    when(invoice.getSubtotal()).thenReturn(new BigDecimal(subtotal));
    when(invoice.getTotal()).thenReturn(new BigDecimal(total));
    when(invoice.getDiscountType()).thenReturn(DiscountType.NONE);
    when(invoice.getClientDisplayName()).thenReturn("MARÍA GONZÁLEZ");
    when(invoice.getClientRucOverride()).thenReturn("3456789-1");
    when(invoice.getStatus()).thenReturn(InvoiceStatus.ISSUED);
    return invoice;
  }

  private Invoice simpleInvoice() {
    return invoice(
        List.of(
            line("Corte de dama", 1, "90000", "10", DiscountType.NONE, null, "90000"),
            line("Perfilado de cejas", 1, "40000", "5", DiscountType.NONE, null, "40000")),
        List.of(payment(PaymentMethod.CASH, "130000")),
        "130000",
        "130000");
  }

  private static String text(byte[] pdf) throws Exception {
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

  private static boolean hasImage(byte[] pdf) throws Exception {
    PdfReader reader = new PdfReader(pdf);
    try {
      PdfDictionary res = reader.getPageN(1).getAsDict(PdfName.RESOURCES);
      PdfDictionary xobjects = res == null ? null : res.getAsDict(PdfName.XOBJECT);
      return xobjects != null && !xobjects.getKeys().isEmpty();
    } finally {
      reader.close();
    }
  }

  // ─── Content ────────────────────────────────────────────────────────────────

  @Test
  void a4_saysNonFiscalAndCarriesTheBusinessAndTheSaleData() throws Exception {
    byte[] pdf =
        service()
            .render(simpleInvoice(), profile(null), "Tenant", NonFiscalReceiptPdfService.Format.A4);
    String t = text(pdf);

    assertThat(t).contains("COMPROBANTE").contains("NO FISCAL");
    assertThat(t).contains("DOCUMENTO SIN VALOR FISCAL").contains("NO ES UNA FACTURA");
    assertThat(t).contains("SIN VALOR FISCAL");
    assertThat(t).contains("Salón Demo").contains("RUC 80099999-1");
    assertThat(t).contains("Av. Mariscal López 1234").contains("Tel. 0981 555 000");
    // The number still comes from the stamp's sequence.
    assertThat(t).contains("001-001-0000123");
    assertThat(t).contains("MARÍA GONZÁLEZ").contains("3456789-1").contains("Contado");
    assertThat(t).contains("Corte de dama").contains("Perfilado de cejas");
    assertThat(t).contains("130.000");
    assertThat(t).contains("Son:").containsIgnoringCase("ciento treinta mil");
    assertThat(t).contains("¡Gracias por tu visita!");
    assertThat(t).contains("No reemplaza a la factura legal");
  }

  @Test
  void a4_carriesNoFiscalData() throws Exception {
    byte[] pdf =
        service()
            .render(simpleInvoice(), profile(null), "Tenant", NonFiscalReceiptPdfService.Format.A4);
    String t = text(pdf);
    // No timbrado, CDC, control number or QR text: this is not a fiscal document.
    assertThat(t).doesNotContain("Timbrado").doesNotContain("12345678");
    assertThat(t).doesNotContain("CDC").doesNotContain("KuDE").doesNotContain("Vigencia");
  }

  @Test
  void a4_discriminatesTheIvaByRate() throws Exception {
    byte[] pdf =
        service()
            .render(simpleInvoice(), profile(null), "Tenant", NonFiscalReceiptPdfService.Format.A4);
    String t = text(pdf);
    // 90.000 at 10% -> 8.182 ; 40.000 at 5% -> 1.905 ; total 10.087
    assertThat(t).contains("Exentas").contains("IVA 5%").contains("IVA 10%");
    assertThat(t).contains("Liquidación del IVA");
    assertThat(t).contains("8.182").contains("1.905").contains("10.087");
  }

  @Test
  void a4_listsEachPaymentWithItsLabelAndTheTipApart() throws Exception {
    InvoicePaymentAllocation card = payment(PaymentMethod.DEBIT_CARD, "100000");
    when(card.getCardBrand()).thenReturn(CardBrand.VISA);
    Invoice invoice =
        invoice(
            List.of(line("Servicio", 1, "130000", "10", DiscountType.NONE, null, "130000")),
            List.of(payment(PaymentMethod.CASH, "30000"), card),
            "130000",
            "130000");
    when(invoice.getTipsAmount()).thenReturn(new BigDecimal("10000"));

    String t =
        text(
            service()
                .render(invoice, profile(null), "Tenant", NonFiscalReceiptPdfService.Format.A4));
    assertThat(t).contains("Forma de pago").contains("Efectivo").contains("30.000");
    assertThat(t).contains("Tarjeta de débito").contains("Visa").contains("100.000");
    assertThat(t).contains("Propina (no incluida en el total): 10.000");
  }

  @Test
  void a4_showsTheDiscountAndTheAttendingProfessional() throws Exception {
    InvoiceLine l = line("Color raíz", 1, "100000", "10", DiscountType.PERCENT, "10", "90000");
    Professional pro = mock(Professional.class);
    when(pro.getDisplayName()).thenReturn("Abril");
    l.setProfessional(pro);
    Invoice invoice =
        invoice(List.of(l), List.of(payment(PaymentMethod.CASH, "90000")), "100000", "90000");
    Client client = new Client();
    client.setFullName("Ignorada");
    when(invoice.getClientDisplayName()).thenReturn(null);
    when(invoice.getClient()).thenReturn(client);
    when(invoice.getClientRucOverride()).thenReturn(null);

    String t =
        text(
            service()
                .render(invoice, profile(null), "Tenant", NonFiscalReceiptPdfService.Format.A4));
    assertThat(t).contains("Dto. 10% Color raíz").contains("Atendió").contains("Abril");
    // A registered client whose name was cleared prints as «Sin nombre»; her profile never leaks
    // in.
    assertThat(t).contains("Sin nombre").doesNotContain("Ignorada");
    assertThat(t).contains("- 10.000");
  }

  @Test
  void anonymousClientIsPrintedAsOccasional() throws Exception {
    Invoice invoice = simpleInvoice();
    when(invoice.getClientDisplayName()).thenReturn(null);
    when(invoice.getClientRucOverride()).thenReturn(null);
    String t =
        text(
            service()
                .render(invoice, profile(null), "Tenant", NonFiscalReceiptPdfService.Format.A4));
    assertThat(t).contains("Cliente ocasional");
  }

  // ─── Ticket ─────────────────────────────────────────────────────────────────

  @Test
  void ticket_is80mmWideAndSaysTheSameThings() throws Exception {
    byte[] pdf =
        service()
            .render(
                simpleInvoice(), profile(null), "Tenant", NonFiscalReceiptPdfService.Format.TICKET);
    PdfReader reader = new PdfReader(pdf);
    try {
      assertThat(reader.getNumberOfPages()).isEqualTo(1);
      assertThat(reader.getPageSize(1).getWidth()).isCloseTo(226.77f, within(0.5f));
      // Continuous paper: the page is as tall as its content, not an A4 sheet.
      assertThat(reader.getPageSize(1).getHeight()).isBetween(260f, 700f);
    } finally {
      reader.close();
    }
    String t = text(pdf);
    assertThat(t).contains("COMPROBANTE NO FISCAL").contains("SIN VALOR FISCAL");
    assertThat(t).contains("001-001-0000123").contains("SALÓN DEMO");
    assertThat(t).contains("TOTAL Gs.").contains("130.000");
    assertThat(t).contains("IVA 5%").contains("IVA 10%").contains("Total IVA");
    assertThat(t).contains("No es factura");
  }

  @Test
  void ticket_growsWithTheNumberOfLines() throws Exception {
    List<InvoiceLine> many = new java.util.ArrayList<>();
    for (int i = 0; i < 25; i++) {
      many.add(line("Item " + i, 1, "1000", "10", DiscountType.NONE, null, "1000"));
    }
    Invoice invoice =
        invoice(many, List.of(payment(PaymentMethod.CASH, "25000")), "25000", "25000");
    byte[] longPdf =
        service()
            .render(invoice, profile(null), "Tenant", NonFiscalReceiptPdfService.Format.TICKET);
    byte[] shortPdf =
        service()
            .render(
                simpleInvoice(), profile(null), "Tenant", NonFiscalReceiptPdfService.Format.TICKET);
    PdfReader longReader = new PdfReader(longPdf);
    PdfReader shortReader = new PdfReader(shortPdf);
    try {
      assertThat(longReader.getPageSize(1).getHeight())
          .isGreaterThan(shortReader.getPageSize(1).getHeight());
    } finally {
      longReader.close();
      shortReader.close();
    }
  }

  // ─── Logo ───────────────────────────────────────────────────────────────────

  @Test
  void logoIsDrawnInBothFormatsWhenTheBusinessHasOne() throws Exception {
    for (NonFiscalReceiptPdfService.Format f : NonFiscalReceiptPdfService.Format.values()) {
      byte[] withLogo = service().render(simpleInvoice(), profile(LOGO_DATA_URL), "Tenant", f);
      byte[] without = service().render(simpleInvoice(), profile(null), "Tenant", f);
      assertThat(hasImage(withLogo)).as("logo in " + f).isTrue();
      assertThat(hasImage(without)).as("no logo in " + f).isFalse();
    }
  }

  @Test
  void aBrokenLogoNeverBlocksTheReceipt() throws Exception {
    byte[] pdf =
        service()
            .render(
                simpleInvoice(),
                profile("data:image/png;base64,@@@no-es-base64@@@"),
                "Tenant",
                NonFiscalReceiptPdfService.Format.A4);
    assertThat(text(pdf)).contains("COMPROBANTE");
    assertThat(hasImage(pdf)).isFalse();
  }

  @Test
  void withoutAProfileTheTenantNameIsUsed() throws Exception {
    byte[] pdf =
        service().render(simpleInvoice(), null, "Mi Salón", NonFiscalReceiptPdfService.Format.A4);
    assertThat(text(pdf)).contains("Mi Salón");
  }

  // ─── Gating and naming ──────────────────────────────────────────────────────

  private void stubInvoice(Invoice invoice) {
    when(invoices.findByIdAndTenant_Id(7L, 1L)).thenReturn(Optional.of(invoice));
    BusinessProfile bp = profile(null);
    when(profiles.findByTenantId(1L)).thenReturn(Optional.of(bp));
  }

  @Test
  void rejectedWhenSifenElectronicInvoicingIsActive() {
    when(flags.isEnabled(eq("SIFEN_ELECTRONIC_INVOICING"), anyLong())).thenReturn(true);
    assertThatThrownBy(() -> service().buildReceipt(7L, 1L, NonFiscalReceiptPdfService.Format.A4))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SIFEN_LEGACY_PDF_DISABLED");
  }

  @Test
  void rejectedWhenTheTierDoesNotHaveTheReceipt() {
    when(flags.isEnabled(eq("SIFEN_ELECTRONIC_INVOICING"), anyLong())).thenReturn(false);
    when(flags.isEnabled(eq("NON_FISCAL_RECEIPT"), anyLong())).thenReturn(false);
    assertThatThrownBy(() -> service().buildReceipt(7L, 1L, NonFiscalReceiptPdfService.Format.A4))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("NON_FISCAL_RECEIPT_NOT_ENABLED");
  }

  @Test
  void onlyIssuedInvoicesHaveAReceipt() {
    when(flags.isEnabled(eq("SIFEN_ELECTRONIC_INVOICING"), anyLong())).thenReturn(false);
    when(flags.isEnabled(eq("NON_FISCAL_RECEIPT"), anyLong())).thenReturn(true);
    Invoice voided = simpleInvoice();
    when(voided.getStatus()).thenReturn(InvoiceStatus.VOIDED);
    stubInvoice(voided);
    assertThatThrownBy(() -> service().buildReceipt(7L, 1L, NonFiscalReceiptPdfService.Format.A4))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("INVOICE_PDF_ONLY_FOR_ISSUED");
  }

  @Test
  void buildsTheReceiptWithTheProposedFilename() {
    when(flags.isEnabled(eq("SIFEN_ELECTRONIC_INVOICING"), anyLong())).thenReturn(false);
    when(flags.isEnabled(eq("NON_FISCAL_RECEIPT"), anyLong())).thenReturn(true);
    stubInvoice(simpleInvoice());

    NonFiscalReceiptPdfService.ReceiptResult a4 =
        service().buildReceipt(7L, 1L, NonFiscalReceiptPdfService.Format.A4);
    NonFiscalReceiptPdfService.ReceiptResult ticket =
        service().buildReceipt(7L, 1L, NonFiscalReceiptPdfService.Format.TICKET);

    assertThat(a4.filename()).isEqualTo("COMPROBANTE-NO-FISCAL-20260407-001-001-0000123.pdf");
    assertThat(ticket.filename())
        .isEqualTo("COMPROBANTE-NO-FISCAL-20260407-001-001-0000123-TICKET.pdf");
    assertThat(new String(a4.bytes(), 0, 5, java.nio.charset.StandardCharsets.US_ASCII))
        .isEqualTo("%PDF-");
  }

  @Test
  void formatParameterDefaultsToA4AndRejectsUnknownValues() {
    assertThat(NonFiscalReceiptPdfService.Format.parse(null))
        .isEqualTo(NonFiscalReceiptPdfService.Format.A4);
    assertThat(NonFiscalReceiptPdfService.Format.parse(" "))
        .isEqualTo(NonFiscalReceiptPdfService.Format.A4);
    assertThat(NonFiscalReceiptPdfService.Format.parse("ticket"))
        .isEqualTo(NonFiscalReceiptPdfService.Format.TICKET);
    assertThatThrownBy(() -> NonFiscalReceiptPdfService.Format.parse("A3"))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("RECEIPT_FORMAT_INVALID");
  }

  // ─── Detail rows and IVA (same rules the old printed invoice had) ───────────

  @Test
  void taxColumnIndex_mapsRatesToColumns() {
    assertThat(NonFiscalReceiptPdfService.taxColumnIndex(new BigDecimal("10.0000"))).isEqualTo(2);
    assertThat(NonFiscalReceiptPdfService.taxColumnIndex(new BigDecimal("5.0000"))).isEqualTo(1);
    assertThat(NonFiscalReceiptPdfService.taxColumnIndex(new BigDecimal("0.0000"))).isEqualTo(0);
    assertThat(NonFiscalReceiptPdfService.taxColumnIndex(null)).isEqualTo(0);
  }

  @Test
  void buildDetailRows_placesGrossInTheColumnOfItsRate() {
    Invoice invoice =
        invoice(
            List.of(
                line("Exenta", 2, "1000", "0", DiscountType.NONE, null, "2000"),
                line("IVA5", 1, "5000", "5", DiscountType.NONE, null, "5000"),
                line("IVA10", 3, "1000", "10", DiscountType.NONE, null, "3000")),
            List.of(),
            "10000",
            "10000");
    List<NonFiscalReceiptPdfService.DetailRow> rows =
        NonFiscalReceiptPdfService.buildDetailRows(invoice);
    assertThat(rows).hasSize(3);
    assertThat(rows.get(0).columnAmounts()[0]).isEqualByComparingTo("2000");
    assertThat(rows.get(1).columnAmounts()[1]).isEqualByComparingTo("5000");
    assertThat(rows.get(2).columnAmounts()[2]).isEqualByComparingTo("3000");
  }

  @Test
  void distributeGlobalDiscount_splitsByColumnAndKeepsTheRemainder() {
    BigDecimal[] net = {new BigDecimal("1000"), BigDecimal.ZERO, new BigDecimal("2000")};
    BigDecimal[] out =
        NonFiscalReceiptPdfService.distributeGlobalDiscount(new BigDecimal("100"), net);
    assertThat(out[0]).isEqualByComparingTo("-33");
    assertThat(out[1]).isNull();
    assertThat(out[2]).isEqualByComparingTo("-67");
    // Whatever the rounding, the parts add up to the whole discount.
    assertThat(out[0].add(out[2])).isEqualByComparingTo("-100");
  }

  @Test
  void ivaIncludedInTotal_extractsTheTaxFromAGrossAmount() {
    assertThat(
            NonFiscalReceiptPdfService.ivaIncludedInTotal(new BigDecimal("110000"), BigDecimal.TEN))
        .isEqualByComparingTo("10000");
    assertThat(
            NonFiscalReceiptPdfService.ivaIncludedInTotal(
                new BigDecimal("105000"), BigDecimal.valueOf(5)))
        .isEqualByComparingTo("5000");
    assertThat(NonFiscalReceiptPdfService.ivaIncludedInTotal(BigDecimal.ZERO, BigDecimal.TEN))
        .isEqualByComparingTo("0");
  }

  @Test
  void globalDiscountRowReadsLikeTheOldPrintedInvoice() {
    Invoice percent =
        invoice(
            List.of(line("Servicio", 1, "100000", "10", DiscountType.NONE, null, "100000")),
            List.of(),
            "100000",
            "90000");
    when(percent.getDiscountType()).thenReturn(DiscountType.PERCENT);
    when(percent.getDiscountValue()).thenReturn(new BigDecimal("10"));
    assertThat(NonFiscalReceiptPdfService.buildDetailRows(percent).get(1).description())
        .isEqualTo("Dto. global 10%");

    Invoice fixed =
        invoice(
            List.of(line("Servicio", 1, "100000", "10", DiscountType.NONE, null, "100000")),
            List.of(),
            "100000",
            "90000");
    when(fixed.getDiscountType()).thenReturn(DiscountType.FIXED);
    when(fixed.getDiscountValue()).thenReturn(new BigDecimal("10000"));
    assertThat(NonFiscalReceiptPdfService.buildDetailRows(fixed).get(1).description())
        .isEqualTo("Dto. global Monto fijo");
  }
}
