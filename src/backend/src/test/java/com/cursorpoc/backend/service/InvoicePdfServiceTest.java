package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.BusinessProfile;
import com.cursorpoc.backend.domain.FiscalStamp;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.InvoiceLine;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.DiscountType;
import com.cursorpoc.backend.domain.enums.InvoiceStatus;
import com.cursorpoc.backend.repository.BusinessProfileRepository;
import com.cursorpoc.backend.repository.InvoiceRepository;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

class InvoicePdfServiceTest {

  @Test
  void renderPdf_containsBusinessRucAndName() {
    FemmeTimeProperties time = new FemmeTimeProperties();
    InvoicePdfService svc =
        new InvoicePdfService(
            mock(BusinessProfileRepository.class),
            mock(InvoiceRepository.class),
            mock(BusinessProfileService.class),
            time);

    BusinessProfile bp = new BusinessProfile();
    bp.setBusinessName("Test Salon");
    bp.setRuc("80000005-6");
    bp.setAddress("Asuncion");
    bp.setPhone("021");
    bp.setContactEmail("x@y.com");

    Tenant tenant = new Tenant();
    tenant.setId(1L);
    FiscalStamp stamp = new FiscalStamp();
    stamp.setStampNumber("SET-1");

    InvoiceLine line = new InvoiceLine();
    line.setDescription("Service A");
    line.setQuantity(1);
    line.setUnitPrice(new BigDecimal("100.00"));
    line.setLineTotal(new BigDecimal("100.00"));

    Invoice invoice = mock(Invoice.class);
    when(invoice.getTenant()).thenReturn(tenant);
    when(invoice.getFiscalStamp()).thenReturn(stamp);
    when(invoice.getInvoiceNumber()).thenReturn(7);
    when(invoice.getIssuedAt()).thenReturn(Instant.parse("2026-04-07T12:00:00Z"));
    when(invoice.getLines()).thenReturn(List.of(line));
    when(invoice.getPaymentAllocations()).thenReturn(List.of());
    when(invoice.getSubtotal()).thenReturn(new BigDecimal("100.00"));
    when(invoice.getTotal()).thenReturn(new BigDecimal("100.00"));
    when(invoice.getDiscountType()).thenReturn(DiscountType.NONE);
    when(invoice.getDiscountValue()).thenReturn(null);
    when(invoice.getClientDisplayName()).thenReturn("Client");
    when(invoice.getClientRucOverride()).thenReturn(null);
    when(invoice.getStatus()).thenReturn(InvoiceStatus.ISSUED);

    byte[] pdf = svc.renderPdf(bp, invoice);
    assertThat(pdf.length).isGreaterThan(200);
    assertThat(pdf).startsWith("%PDF".getBytes(java.nio.charset.StandardCharsets.US_ASCII));
  }
}
