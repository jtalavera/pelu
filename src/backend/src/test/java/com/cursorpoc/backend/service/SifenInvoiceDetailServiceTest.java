package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.InvoiceLine;
import com.cursorpoc.backend.domain.InvoicePaymentAllocation;
import com.cursorpoc.backend.domain.SalonService;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.CardBrand;
import com.cursorpoc.backend.domain.enums.PaymentMethod;
import com.cursorpoc.backend.domain.enums.SifenTaxAffectation;
import com.cursorpoc.backend.repository.InvoiceRepository;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.server.ResponseStatusException;

@ExtendWith(MockitoExtension.class)
class SifenInvoiceDetailServiceTest {

  private static final long TENANT_ID = 1L;
  private static final long INVOICE_ID = 100L;

  @Mock private InvoiceRepository invoiceRepository;

  private SifenInvoiceDetailService service;
  private Invoice invoice;

  @BeforeEach
  void setUp() {
    service = new SifenInvoiceDetailService(invoiceRepository);

    Tenant tenant = new Tenant();
    tenant.setId(TENANT_ID);

    invoice = new Invoice();
    invoice.setId(INVOICE_ID);
    invoice.setTenant(tenant);

    lenient()
        .when(invoiceRepository.findByIdAndTenant_Id(INVOICE_ID, TENANT_ID))
        .thenReturn(Optional.of(invoice));
  }

  private InvoiceLine addLine(
      String description, int quantity, BigDecimal unitPrice, BigDecimal taxRatePercent) {
    InvoiceLine line = new InvoiceLine();
    line.setId((long) (invoice.getLines().size() + 1));
    line.setInvoice(invoice);
    line.setDescription(description);
    line.setQuantity(quantity);
    line.setUnitPrice(unitPrice);
    BigDecimal grossTotal = unitPrice.multiply(BigDecimal.valueOf(quantity));
    line.setLineTotal(grossTotal);
    line.setTaxRate(taxRatePercent);
    if (taxRatePercent.compareTo(BigDecimal.ZERO) > 0) {
      line.setTaxAmount(
          grossTotal
              .multiply(taxRatePercent)
              .divide(BigDecimal.valueOf(100).add(taxRatePercent), 4, RoundingMode.HALF_UP));
    } else {
      line.setTaxAmount(BigDecimal.ZERO);
    }
    invoice.getLines().add(line);
    return line;
  }

  private void addPayment(PaymentMethod method, BigDecimal amount) {
    InvoicePaymentAllocation allocation = new InvoicePaymentAllocation();
    allocation.setInvoice(invoice);
    allocation.setMethod(method);
    allocation.setAmount(amount);
    invoice.getPaymentAllocations().add(allocation);
  }

  private void addCardPayment(
      PaymentMethod method, BigDecimal amount, CardBrand cardBrand, String otherDescription) {
    InvoicePaymentAllocation allocation = new InvoicePaymentAllocation();
    allocation.setInvoice(invoice);
    allocation.setMethod(method);
    allocation.setAmount(amount);
    allocation.setCardBrand(cardBrand);
    allocation.setCardBrandOtherDescription(otherDescription);
    invoice.getPaymentAllocations().add(allocation);
  }

  /** Mirrors what {@code InvoiceService.issueInvoice} already computed and persisted. */
  private void finalizeTotals(BigDecimal globalDiscountAmount) {
    BigDecimal subtotal =
        invoice.getLines().stream()
            .map(InvoiceLine::getLineTotal)
            .reduce(BigDecimal.ZERO, BigDecimal::add);
    invoice.setSubtotal(subtotal);
    invoice.setTotal(subtotal.subtract(globalDiscountAmount));
  }

  /** AC-01: one line per billed service, with description, quantity and unit price. */
  @Test
  void buildDetail_includesOneLinePerService_withDescriptionQuantityAndUnitPrice() {
    addLine("Corte de cabello", 2, new BigDecimal("50000.00"), BigDecimal.ZERO);
    addLine("Manicura", 1, new BigDecimal("30000.00"), BigDecimal.ZERO);
    finalizeTotals(BigDecimal.ZERO);

    var lines = service.buildDetail(TENANT_ID, INVOICE_ID).lines();

    assertThat(lines).hasSize(2);
    assertThat(lines.get(0).description()).isEqualTo("Corte de cabello");
    assertThat(lines.get(0).quantity()).isEqualTo(2);
    assertThat(lines.get(0).unitPrice()).isEqualByComparingTo("50000.00");
    assertThat(lines.get(0).unitOfMeasureCode()).isEqualTo("77");
    assertThat(lines.get(1).description()).isEqualTo("Manicura");
  }

  /** AC-01: a line linked to a SalonService gets a code derived from it, unique per item. */
  @Test
  void buildDetail_lineWithLinkedService_usesServiceBasedInternalCode() {
    SalonService salonService = new SalonService();
    salonService.setId(77L);
    InvoiceLine line = addLine("Corte", 1, new BigDecimal("100.00"), BigDecimal.ZERO);
    line.setSalonService(salonService);
    finalizeTotals(BigDecimal.ZERO);

    assertThat(service.buildDetail(TENANT_ID, INVOICE_ID).lines().get(0).internalCode())
        .isEqualTo("SVC-77");
  }

  /** AC-01/AC-02: a line without a linked service still gets a stable, unique internal code. */
  @Test
  void buildDetail_lineWithoutLinkedService_usesLineBasedInternalCode() {
    addLine("Servicio a medida", 1, new BigDecimal("100.00"), BigDecimal.ZERO);
    finalizeTotals(BigDecimal.ZERO);

    assertThat(service.buildDetail(TENANT_ID, INVOICE_ID).lines().get(0).internalCode())
        .isEqualTo("LIN-1");
  }

  /**
   * AC-02: descriptions longer than SIFEN's 120-char item-name limit are truncated for dDesProSer,
   * but the full text (up to 500 chars) survives in dInfItem.
   */
  @Test
  void buildDetail_longDescription_truncatesItemNameAndKeepsFullTextAsAdditionalInfo() {
    String longDescription = "x".repeat(1800);
    addLine(longDescription, 1, new BigDecimal("10000.00"), BigDecimal.ZERO);
    finalizeTotals(BigDecimal.ZERO);

    SifenInvoiceLine line = service.buildDetail(TENANT_ID, INVOICE_ID).lines().get(0);

    assertThat(line.description()).hasSize(120).isEqualTo(longDescription.substring(0, 120));
    assertThat(line.additionalInfo()).hasSize(500).isEqualTo(longDescription.substring(0, 500));
  }

  /** AC-02 (contrast): a description that already fits doesn't need the additional-info field. */
  @Test
  void buildDetail_shortDescription_doesNotSetAdditionalInfo() {
    addLine("Corte", 1, new BigDecimal("10000.00"), BigDecimal.ZERO);
    finalizeTotals(BigDecimal.ZERO);

    assertThat(service.buildDetail(TENANT_ID, INVOICE_ID).lines().get(0).additionalInfo()).isNull();
  }

  /** AC-03: gravado at 10% — taxable base and tax amount computed per the manual's formula. */
  @Test
  void buildDetail_gravado10_computesTaxableBaseAndTaxAmount() {
    addLine("Corte", 1, new BigDecimal("110.00"), new BigDecimal("10"));
    finalizeTotals(BigDecimal.ZERO);

    SifenInvoiceLine line = service.buildDetail(TENANT_ID, INVOICE_ID).lines().get(0);

    assertThat(line.taxAffectation()).isEqualTo(SifenTaxAffectation.GRAVADO);
    assertThat(line.taxRatePercent()).isEqualByComparingTo("10");
    assertThat(line.taxableBase()).isEqualByComparingTo("100.0000");
    assertThat(line.taxAmount()).isEqualByComparingTo("10.0000");
  }

  /** AC-03: gravado at 5%, same formula, different rate. */
  @Test
  void buildDetail_gravado5_computesTaxableBaseAndTaxAmount() {
    addLine("Tintura", 1, new BigDecimal("105.00"), new BigDecimal("5"));
    finalizeTotals(BigDecimal.ZERO);

    SifenInvoiceLine line = service.buildDetail(TENANT_ID, INVOICE_ID).lines().get(0);

    assertThat(line.taxRatePercent()).isEqualByComparingTo("5");
    assertThat(line.taxableBase()).isEqualByComparingTo("100.0000");
    assertThat(line.taxAmount()).isEqualByComparingTo("5.0000");
  }

  /** AC-03: exento — no tax rate, base or amount. */
  @Test
  void buildDetail_exempt_hasZeroTaxableBaseAndAmount() {
    addLine("Consulta", 1, new BigDecimal("50000.00"), BigDecimal.ZERO);
    finalizeTotals(BigDecimal.ZERO);

    SifenInvoiceLine line = service.buildDetail(TENANT_ID, INVOICE_ID).lines().get(0);

    assertThat(line.taxAffectation()).isEqualTo(SifenTaxAffectation.EXENTO);
    assertThat(line.taxRatePercent()).isEqualByComparingTo("0");
    assertThat(line.taxableBase()).isEqualByComparingTo("0");
    assertThat(line.taxAmount()).isEqualByComparingTo("0");
  }

  /**
   * Issue #174 AC-01: a "Tarjeta Diplomática de exoneración fiscal" receiver makes every line
   * EXONERADO (iAfecIVA=2) with zero IVA, and its net total lands in the exonerated subtotal bucket
   * (F003/dSubExo).
   */
  @Test
  void buildDetail_diplomaticReceiver_marksLinesExoneradoAndFillsExoneratedSubtotal() {
    invoice.setClientIdentityDocumentTypeOverride(
        com.cursorpoc.backend.domain.enums.ClientIdentityDocumentType.TARJETA_DIPLOMATICA);
    invoice.setClientIdentityDocumentOverride("DIP-001");
    // Already netted at issue time (see InvoiceService), so the line carries a 0 tax rate.
    addLine("Corte", 1, new BigDecimal("100000.00"), BigDecimal.ZERO);
    finalizeTotals(BigDecimal.ZERO);

    SifenInvoiceDetail detail = service.buildDetail(TENANT_ID, INVOICE_ID);
    SifenInvoiceLine line = detail.lines().get(0);

    assertThat(line.taxAffectation()).isEqualTo(SifenTaxAffectation.EXONERADO);
    assertThat(line.taxAmount()).isEqualByComparingTo("0");
    assertThat(detail.totals().exoneratedSubtotal()).isEqualByComparingTo("100000.00");
    assertThat(detail.totals().exemptSubtotal()).isEqualByComparingTo("0");
    assertThat(detail.totals().grossTotal()).isEqualByComparingTo("100000.00");
  }

  /** AC-03: SIFEN only accepts 5% or 10% for a gravado line — any other rate is rejected. */
  @Test
  void buildDetail_unsupportedTaxRate_throws() {
    addLine("Servicio con tasa no soportada", 1, new BigDecimal("100.00"), new BigDecimal("7"));
    finalizeTotals(BigDecimal.ZERO);

    assertThatThrownBy(() -> service.buildDetail(TENANT_ID, INVOICE_ID))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SIFEN_UNSUPPORTED_TAX_RATE");
  }

  /** AC-04: the document's net total equals the sum of every line's net total. */
  @Test
  void buildDetail_netTotal_equalsSumOfLinesAndInvoiceTotal() {
    addLine("Corte", 1, new BigDecimal("110.00"), new BigDecimal("10"));
    addLine("Manicura", 2, new BigDecimal("52.50"), new BigDecimal("5"));
    finalizeTotals(BigDecimal.ZERO);

    SifenInvoiceDetail detail = service.buildDetail(TENANT_ID, INVOICE_ID);

    BigDecimal sumOfLines =
        detail.lines().stream()
            .map(SifenInvoiceLine::netTotal)
            .reduce(BigDecimal.ZERO, BigDecimal::add);
    assertThat(detail.totals().netTotal()).isEqualByComparingTo(sumOfLines);
    assertThat(detail.totals().netTotal()).isEqualByComparingTo(invoice.getTotal());
  }

  /**
   * AC-05: an invoice-level discount is prorated across lines proportionally, and the total still
   * matches the sum of the (now discounted) lines exactly.
   */
  @Test
  void buildDetail_globalDiscount_isProratedAcrossLinesAndTotalReflectsIt() {
    addLine("Corte", 1, new BigDecimal("100.00"), BigDecimal.ZERO);
    addLine("Manicura", 1, new BigDecimal("300.00"), BigDecimal.ZERO);
    finalizeTotals(new BigDecimal("40.00"));

    SifenInvoiceDetail detail = service.buildDetail(TENANT_ID, INVOICE_ID);

    BigDecimal sumOfLines =
        detail.lines().stream()
            .map(SifenInvoiceLine::netTotal)
            .reduce(BigDecimal.ZERO, BigDecimal::add);
    assertThat(sumOfLines).isEqualByComparingTo(invoice.getTotal());
    assertThat(detail.totals().globalDiscountTotal()).isEqualByComparingTo("40.00");
    // 40/400 gross = 10% global rate, applied to each line's own unit price: 100*10%=10,
    // 300*10%=30.
    assertThat(detail.lines().get(0).netTotal()).isEqualByComparingTo("90.00");
    assertThat(detail.lines().get(1).netTotal()).isEqualByComparingTo("270.00");
    assertThat(detail.lines().get(0).globalDiscountAmount()).isEqualByComparingTo("10.00");
    assertThat(detail.lines().get(1).globalDiscountAmount()).isEqualByComparingTo("30.00");
    assertThat(detail.lines().get(0).itemDiscountAmount()).isEqualByComparingTo("0");
    assertThat(detail.lines().get(1).itemDiscountAmount()).isEqualByComparingTo("0");
  }

  /**
   * AC-05 (contrast): an item-level discount alone (no global discount) is reported only as
   * itemDiscountAmount — globalDiscountAmount stays zero.
   */
  @Test
  void buildDetail_itemDiscountOnly_isReportedSeparatelyFromGlobalDiscount() {
    InvoiceLine line = addLine("Corte", 1, new BigDecimal("100.00"), BigDecimal.ZERO);
    line.setLineTotal(new BigDecimal("80.00"));
    finalizeTotals(BigDecimal.ZERO);

    SifenInvoiceLine detailLine = service.buildDetail(TENANT_ID, INVOICE_ID).lines().get(0);

    assertThat(detailLine.itemDiscountAmount()).isEqualByComparingTo("20.00");
    assertThat(detailLine.globalDiscountAmount()).isEqualByComparingTo("0");
    assertThat(detailLine.netTotal()).isEqualByComparingTo("80.00");
  }

  /**
   * AC-05: an item with its own discount AND a share of the invoice-level global discount reports
   * both independently, including for a line with quantity &gt; 1 — the exact combination that was
   * rejected live (SIFEN error 1852, "Porcentaje de descuento particular por ítem no informado",
   * and then 1862, "El descuento global ... no coincidente con lo informado", once 1852 was fixed).
   *
   * <p>The global discount must be the SAME percentage on every line's own unit price — not each
   * line's weighted share of the invoice total — precisely because line A also has a particular
   * discount: weighting by each line's (already-discounted) value would skew the percentage away
   * from a flat rate, which is exactly what triggered the live 1862 rejection.
   */
  @Test
  void buildDetail_itemAndGlobalDiscountCombined_reportsBothIndependently() {
    InvoiceLine lineA = addLine("Corte", 1, new BigDecimal("100.00"), BigDecimal.ZERO);
    lineA.setLineTotal(new BigDecimal("80.00")); // Rebaja de 20 (item-level discount)
    addLine("Manicura", 2, new BigDecimal("150.00"), BigDecimal.ZERO); // qty > 1, no item discount
    finalizeTotals(new BigDecimal("38.00"));

    SifenInvoiceDetail detail = service.buildDetail(TENANT_ID, INVOICE_ID);
    SifenInvoiceLine detailLineA = detail.lines().get(0);
    SifenInvoiceLine detailLineB = detail.lines().get(1);

    assertThat(detailLineA.itemDiscountAmount()).isEqualByComparingTo("20.00");
    // Global rate = 38 / (100*1 + 150*2) gross = 9.5%, applied to each line's OWN unit price:
    // 100*9.5%=9.50, 150*9.5%=14.25 — identical 9.5% for both lines despite line A's own discount.
    assertThat(detailLineA.globalDiscountAmount()).isEqualByComparingTo("9.50");
    assertThat(detailLineB.itemDiscountAmount()).isEqualByComparingTo("0");
    assertThat(detailLineB.globalDiscountAmount()).isEqualByComparingTo("14.25");
    assertThat(detail.totals().globalDiscountPercent()).isEqualByComparingTo("9.50000000");

    BigDecimal sumOfLines =
        detail.lines().stream()
            .map(SifenInvoiceLine::netTotal)
            .reduce(BigDecimal.ZERO, BigDecimal::add);
    assertThat(sumOfLines).isEqualByComparingTo(invoice.getTotal());
  }

  /**
   * Issue #170: reproduces the exact Comprobante #0001032 shape that SIFEN rejected live with "XML
   * malformado [El valor -0.01 del elemento: dRedon es invalido]" — 12 lines (two at 10.000, one at
   * 20.000, one at 30.000, eight at 50.000 Gs), a 50.000 Gs global discount, subtotal 470.000,
   * total 420.000. Summing each line's independently-HALF_UP-rounded globalDiscountAmount drifts
   * 0.01 above the true 50.000 Gs discount, which would otherwise make {@code roundingAdjustment}
   * (dRedon) come out as -0.01 — an unsigned SIFEN field that must never be negative.
   */
  @Test
  void buildTotals_discountRoundingDrift_neverProducesNegativeRedon() {
    addLine("LAVADO", 1, new BigDecimal("10000.00"), BigDecimal.ZERO);
    addLine("MANOS", 1, new BigDecimal("10000.00"), BigDecimal.ZERO);
    addLine("PIES", 1, new BigDecimal("20000.00"), BigDecimal.ZERO);
    addLine("SPA DE PIES", 1, new BigDecimal("30000.00"), BigDecimal.ZERO);
    for (int i = 0; i < 8; i++) {
      addLine("Producto " + i, 1, new BigDecimal("50000.00"), BigDecimal.ZERO);
    }
    finalizeTotals(new BigDecimal("50000.00"));

    SifenInvoiceDetail detail = service.buildDetail(TENANT_ID, INVOICE_ID);

    assertThat(invoice.getTotal()).isEqualByComparingTo("420000.00");
    assertThat(detail.totals().roundingAdjustment().signum()).isGreaterThanOrEqualTo(0);
  }

  /** AC-06: each payment allocation maps to SIFEN's payment-type code; sale is always Contado. */
  @Test
  void buildDetail_paymentAllocations_mapToSifenPaymentTypes() {
    addLine("Corte", 1, new BigDecimal("100.00"), BigDecimal.ZERO);
    finalizeTotals(BigDecimal.ZERO);
    addPayment(PaymentMethod.CASH, new BigDecimal("40.00"));
    addPayment(PaymentMethod.CREDIT_CARD, new BigDecimal("20.00"));
    addPayment(PaymentMethod.DEBIT_CARD, new BigDecimal("20.00"));
    addPayment(PaymentMethod.TRANSFER, new BigDecimal("10.00"));
    addPayment(PaymentMethod.OTHER, new BigDecimal("10.00"));

    SifenInvoiceDetail detail = service.buildDetail(TENANT_ID, INVOICE_ID);

    assertThat(detail.paymentCondition()).isEqualTo(1);
    assertThat(detail.payments())
        .extracting(SifenPaymentDetail::typeCode)
        .containsExactly(1, 3, 4, 5, 99);
  }

  /**
   * Issue #170: the card brand captured on a CREDIT_CARD/DEBIT_CARD allocation must reach {@link
   * SifenPaymentDetail} unchanged, so {@code SifenDocumentXmlService} can emit the mandatory
   * gPagTarCD group.
   */
  @Test
  void buildDetail_cardPayment_threadsCardBrandIntoPaymentDetail() {
    addLine("Corte", 1, new BigDecimal("100.00"), BigDecimal.ZERO);
    finalizeTotals(BigDecimal.ZERO);
    addCardPayment(PaymentMethod.CREDIT_CARD, new BigDecimal("100.00"), CardBrand.VISA, null);

    SifenInvoiceDetail detail = service.buildDetail(TENANT_ID, INVOICE_ID);

    assertThat(detail.payments()).hasSize(1);
    assertThat(detail.payments().get(0).cardBrand()).isEqualTo(CardBrand.VISA);
    assertThat(detail.payments().get(0).cardBrandOtherDescription()).isNull();
  }

  @Test
  void buildDetail_cardPaymentWithOtherBrand_threadsFreeTextDescription() {
    addLine("Corte", 1, new BigDecimal("100.00"), BigDecimal.ZERO);
    finalizeTotals(BigDecimal.ZERO);
    addCardPayment(
        PaymentMethod.DEBIT_CARD, new BigDecimal("100.00"), CardBrand.OTHER, "Union Pay");

    SifenInvoiceDetail detail = service.buildDetail(TENANT_ID, INVOICE_ID);

    assertThat(detail.payments().get(0).cardBrand()).isEqualTo(CardBrand.OTHER);
    assertThat(detail.payments().get(0).cardBrandOtherDescription()).isEqualTo("Union Pay");
  }

  @Test
  void buildDetail_invoiceNotFound_throws() {
    when(invoiceRepository.findByIdAndTenant_Id(999L, TENANT_ID)).thenReturn(Optional.empty());

    assertThatThrownBy(() -> service.buildDetail(TENANT_ID, 999L))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("INVOICE_NOT_FOUND");
  }
}
