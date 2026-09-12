package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.enums.InvoiceStatus;
import com.cursorpoc.backend.domain.enums.PaymentMethod;
import com.cursorpoc.backend.repository.AppointmentRepository;
import com.cursorpoc.backend.repository.ClientRepository;
import com.cursorpoc.backend.repository.FiscalStampRepository;
import com.cursorpoc.backend.repository.InvoiceRepository;
import com.cursorpoc.backend.web.dto.DashboardResponse;
import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.Mockito;
import org.mockito.junit.jupiter.MockitoExtension;

/**
 * Issue #221 — "Dashboard: gráfico de mezcla de medios de pago": unit coverage of {@link
 * DashboardService#buildPaymentMethodMix}.
 */
@ExtendWith(MockitoExtension.class)
class DashboardServicePaymentMethodMixTest {

  @Mock private AppointmentRepository appointmentRepository;
  @Mock private ClientRepository clientRepository;
  @Mock private InvoiceRepository invoiceRepository;
  @Mock private FiscalStampRepository fiscalStampRepository;
  @Mock private BusinessProfileService businessProfileService;
  @Mock private SifenNumberVoidingService sifenNumberVoidingService;

  private DashboardService dashboardService;

  @BeforeEach
  void setUp() {
    FemmeTimeProperties time = new FemmeTimeProperties();
    time.setBusinessZoneId("America/Asuncion");
    dashboardService =
        new DashboardService(
            time,
            appointmentRepository,
            clientRepository,
            invoiceRepository,
            fiscalStampRepository,
            businessProfileService,
            sifenNumberVoidingService);
    when(businessProfileService.isRucReadyForInvoicing(1L)).thenReturn(true);
    when(fiscalStampRepository.findByTenant_IdAndActiveTrue(1L)).thenReturn(Optional.empty());
    when(clientRepository.findActiveClientsWithLastCompletedVisit(eq(1L), any()))
        .thenReturn(List.of());
  }

  @Test
  void emptyWhenNoPaymentAllocationsInWindow() {
    when(invoiceRepository.findPaymentMethodRevenueByTenantAndStatusAndIssuedBetween(
            eq(1L), eq(InvoiceStatus.ISSUED), any(), any()))
        .thenReturn(List.of());

    DashboardResponse d = dashboardService.build(1L);

    assertThat(d.paymentMethodMix()).isEmpty();
  }

  @Test
  void mapsEveryMethodPresentInPeriodPreservingRepositoryOrder() {
    when(invoiceRepository.findPaymentMethodRevenueByTenantAndStatusAndIssuedBetween(
            eq(1L), eq(InvoiceStatus.ISSUED), any(), any()))
        .thenReturn(
            List.of(
                new PaymentMethodRevenueRow(PaymentMethod.CASH, new BigDecimal("500000")),
                new PaymentMethodRevenueRow(PaymentMethod.TRANSFER, new BigDecimal("300000")),
                new PaymentMethodRevenueRow(PaymentMethod.CREDIT_CARD, new BigDecimal("150000"))));

    DashboardResponse d = dashboardService.build(1L);

    assertThat(d.paymentMethodMix())
        .extracting(DashboardResponse.PaymentMethodMix::method)
        .containsExactly("CASH", "TRANSFER", "CREDIT_CARD");
    assertThat(d.paymentMethodMix().get(0).amount()).isEqualByComparingTo(new BigDecimal("500000"));
  }

  @Test
  void doesNotCapTheNumberOfMethodsReturned() {
    // PaymentMethod only has 5 values today, but the AC forbids a hardcoded subset — assert every
    // enum value present in the repository result survives untouched, not just a top-N slice.
    List<PaymentMethodRevenueRow> rows =
        List.of(
            new PaymentMethodRevenueRow(PaymentMethod.CASH, new BigDecimal("5")),
            new PaymentMethodRevenueRow(PaymentMethod.DEBIT_CARD, new BigDecimal("4")),
            new PaymentMethodRevenueRow(PaymentMethod.CREDIT_CARD, new BigDecimal("3")),
            new PaymentMethodRevenueRow(PaymentMethod.TRANSFER, new BigDecimal("2")),
            new PaymentMethodRevenueRow(PaymentMethod.OTHER, new BigDecimal("1")));
    when(invoiceRepository.findPaymentMethodRevenueByTenantAndStatusAndIssuedBetween(
            eq(1L), eq(InvoiceStatus.ISSUED), any(), any()))
        .thenReturn(rows);

    DashboardResponse d = dashboardService.build(1L);

    assertThat(d.paymentMethodMix()).hasSize(PaymentMethod.values().length);
  }

  @Test
  void queriesTheSameTrailingWindowAsRevenueTrend() {
    when(invoiceRepository.findPaymentMethodRevenueByTenantAndStatusAndIssuedBetween(
            eq(1L), eq(InvoiceStatus.ISSUED), any(), any()))
        .thenReturn(List.of());

    dashboardService.build(1L);

    Mockito.verify(invoiceRepository)
        .findPaymentMethodRevenueByTenantAndStatusAndIssuedBetween(
            eq(1L), eq(InvoiceStatus.ISSUED), any(), any());
  }
}
