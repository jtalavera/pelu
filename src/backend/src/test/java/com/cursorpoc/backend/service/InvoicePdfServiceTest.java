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

  @Test
  void renderPdf_isValidAndContainsInvoiceNumber() throws Exception {
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
    assertThat(text).contains("0000007");
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
