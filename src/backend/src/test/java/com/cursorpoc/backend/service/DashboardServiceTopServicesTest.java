package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.enums.InvoiceStatus;
import com.cursorpoc.backend.repository.AppointmentRepository;
import com.cursorpoc.backend.repository.ClientRepository;
import com.cursorpoc.backend.repository.FiscalStampRepository;
import com.cursorpoc.backend.repository.InvoiceRepository;
import com.cursorpoc.backend.web.dto.DashboardResponse;
import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import java.util.stream.IntStream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/**
 * Issue #220 — "Dashboard: gráfico de servicios más vendidos": unit coverage of {@link
 * DashboardService#buildTopServices}.
 */
@ExtendWith(MockitoExtension.class)
class DashboardServiceTopServicesTest {

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
  void emptyWhenNoServiceRevenue() {
    when(invoiceRepository.findServiceRevenueByTenantAndStatusAndIssuedBetween(
            eq(1L), eq(InvoiceStatus.ISSUED), any(), any()))
        .thenReturn(List.of());

    DashboardResponse d = dashboardService.build(1L);

    assertThat(d.topServices()).isEmpty();
  }

  @Test
  void mapsServiceNameAndRevenuePreservingRepositoryOrder() {
    when(invoiceRepository.findServiceRevenueByTenantAndStatusAndIssuedBetween(
            eq(1L), eq(InvoiceStatus.ISSUED), any(), any()))
        .thenReturn(
            List.of(
                new ServiceRevenueRow(1L, "Corte de cabello", new BigDecimal("500000")),
                new ServiceRevenueRow(2L, "Manicura", new BigDecimal("300000")),
                new ServiceRevenueRow(3L, "Coloración", new BigDecimal("150000"))));

    DashboardResponse d = dashboardService.build(1L);

    assertThat(d.topServices())
        .extracting(DashboardResponse.TopService::serviceName)
        .containsExactly("Corte de cabello", "Manicura", "Coloración");
    assertThat(d.topServices().get(0).revenue()).isEqualByComparingTo(new BigDecimal("500000"));
  }

  @Test
  void cappedToTopServicesLimit() {
    List<ServiceRevenueRow> rows =
        IntStream.rangeClosed(1, DashboardService.TOP_SERVICES_LIMIT + 5)
            .mapToObj(
                i ->
                    new ServiceRevenueRow(
                        (long) i,
                        "Service " + i,
                        BigDecimal.valueOf(
                            (DashboardService.TOP_SERVICES_LIMIT + 5 - i) * 10_000L)))
            .toList();
    when(invoiceRepository.findServiceRevenueByTenantAndStatusAndIssuedBetween(
            eq(1L), eq(InvoiceStatus.ISSUED), any(), any()))
        .thenReturn(rows);

    DashboardResponse d = dashboardService.build(1L);

    assertThat(d.topServices()).hasSize(DashboardService.TOP_SERVICES_LIMIT);
    assertThat(d.topServices().get(0).serviceName()).isEqualTo("Service 1");
  }

  @Test
  void queriesTheSameTrailingWindowAsRevenueTrend() {
    when(invoiceRepository.findServiceRevenueByTenantAndStatusAndIssuedBetween(
            eq(1L), eq(InvoiceStatus.ISSUED), any(), any()))
        .thenReturn(List.of());

    dashboardService.build(1L);

    org.mockito.Mockito.verify(invoiceRepository)
        .findServiceRevenueByTenantAndStatusAndIssuedBetween(
            eq(1L), eq(InvoiceStatus.ISSUED), any(), any());
  }
}
