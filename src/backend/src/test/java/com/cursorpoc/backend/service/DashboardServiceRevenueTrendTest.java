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
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/**
 * Issue #219 — "Dashboard: fundamentos de gráficos + tendencia de facturación": unit coverage of
 * {@link DashboardService#buildRevenueTrend}.
 */
@ExtendWith(MockitoExtension.class)
class DashboardServiceRevenueTrendTest {

  private static final ZoneId ZONE = ZoneId.of("America/Asuncion");

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
    time.setBusinessZoneId(ZONE.getId());
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

  private Instant daysAgoAtNoon(long days) {
    return LocalDate.now(ZONE).minusDays(days).atTime(12, 0).atZone(ZONE).toInstant();
  }

  @Test
  void returnsExactlyRevenueTrendDaysPointsOrderedOldestFirst() {
    when(invoiceRepository.findRevenueRowsByTenantAndStatusAndIssuedBetween(
            eq(1L), eq(InvoiceStatus.ISSUED), any(), any()))
        .thenReturn(List.of());

    DashboardResponse d = dashboardService.build(1L);

    assertThat(d.revenueTrend()).hasSize(DashboardService.REVENUE_TREND_DAYS);
    assertThat(d.revenueTrendDays()).isEqualTo(DashboardService.REVENUE_TREND_DAYS);
    LocalDate today = LocalDate.now(ZONE);
    LocalDate expectedFirst = today.minusDays(DashboardService.REVENUE_TREND_DAYS - 1L);
    assertThat(d.revenueTrend().get(0).date()).isEqualTo(expectedFirst.toString());
    assertThat(d.revenueTrend().get(d.revenueTrend().size() - 1).date())
        .isEqualTo(today.toString());
  }

  @Test
  void daysWithNoInvoicesAreZeroNotOmitted() {
    when(invoiceRepository.findRevenueRowsByTenantAndStatusAndIssuedBetween(
            eq(1L), eq(InvoiceStatus.ISSUED), any(), any()))
        .thenReturn(List.of());

    DashboardResponse d = dashboardService.build(1L);

    assertThat(d.revenueTrend())
        .allSatisfy(p -> assertThat(p.invoiced()).isEqualByComparingTo(BigDecimal.ZERO));
  }

  @Test
  void sumsMultipleInvoicesOnTheSameDayIntoOnePoint() {
    Instant fiveDaysAgo = daysAgoAtNoon(5);
    when(invoiceRepository.findRevenueRowsByTenantAndStatusAndIssuedBetween(
            eq(1L), eq(InvoiceStatus.ISSUED), any(), any()))
        .thenReturn(
            List.of(
                new InvoiceRevenueRow(fiveDaysAgo, new BigDecimal("100000")),
                new InvoiceRevenueRow(
                    fiveDaysAgo.plus(1, ChronoUnit.HOURS), new BigDecimal("50000"))));

    DashboardResponse d = dashboardService.build(1L);

    String expectedDate = LocalDate.now(ZONE).minusDays(5).toString();
    var point =
        d.revenueTrend().stream()
            .filter(p -> p.date().equals(expectedDate))
            .findFirst()
            .orElseThrow();
    assertThat(point.invoiced()).isEqualByComparingTo(new BigDecimal("150000"));
  }

  @Test
  void bucketsByBusinessTimezoneCalendarDayNotServerInstantDay() {
    // 23:30 five days ago in the business zone — still that calendar day in the business zone,
    // but could roll to the next UTC day depending on the offset; bucketing must follow the
    // business zone, not a bare UTC LocalDate.
    LocalDate fiveDaysAgo = LocalDate.now(ZONE).minusDays(5);
    Instant lateInBusinessZone = fiveDaysAgo.atTime(23, 30).atZone(ZONE).toInstant();
    when(invoiceRepository.findRevenueRowsByTenantAndStatusAndIssuedBetween(
            eq(1L), eq(InvoiceStatus.ISSUED), any(), any()))
        .thenReturn(List.of(new InvoiceRevenueRow(lateInBusinessZone, new BigDecimal("77000"))));

    DashboardResponse d = dashboardService.build(1L);

    var point =
        d.revenueTrend().stream()
            .filter(p -> p.date().equals(fiveDaysAgo.toString()))
            .findFirst()
            .orElseThrow();
    assertThat(point.invoiced()).isEqualByComparingTo(new BigDecimal("77000"));
  }
}
