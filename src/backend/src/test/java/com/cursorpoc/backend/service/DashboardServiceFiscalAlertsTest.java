package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.FiscalStamp;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.AppointmentStatus;
import com.cursorpoc.backend.repository.AppointmentRepository;
import com.cursorpoc.backend.repository.ClientRepository;
import com.cursorpoc.backend.repository.FiscalStampRepository;
import com.cursorpoc.backend.repository.InvoiceRepository;
import com.cursorpoc.backend.web.dto.DashboardResponse;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class DashboardServiceFiscalAlertsTest {

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
    when(clientRepository.findActiveClientsWithLastCompletedVisit(
            eq(1L), eq(AppointmentStatus.COMPLETED)))
        .thenReturn(List.of());
  }

  @Test
  void clientsInPeriodCountsDistinctClientsOverTheRequestedWindow() {
    when(businessProfileService.isRucReadyForInvoicing(1L)).thenReturn(true);
    when(fiscalStampRepository.findByTenant_IdAndActiveTrue(1L)).thenReturn(Optional.empty());
    // Month window (any other range) answers 0; each requested period answers its own figure.
    when(appointmentRepository.countDistinctClientsWithAppointmentsBetween(eq(1L), any(), any()))
        .thenAnswer(
            inv -> {
              java.time.Instant from = inv.getArgument(1);
              java.time.Instant to = inv.getArgument(2);
              long spanDays = java.time.Duration.between(from, to).toDays();
              return spanDays == 7 ? 4L : spanDays == 90 ? 40L : 0L;
            });

    assertThat(dashboardService.build(1L, 7).clientsInPeriod()).isEqualTo(4L);
    assertThat(dashboardService.build(1L, 90).clientsInPeriod()).isEqualTo(40L);
  }

  @Test
  void blockingAlertWhenNoActiveStampAndRucReady() {
    when(businessProfileService.isRucReadyForInvoicing(1L)).thenReturn(true);
    when(fiscalStampRepository.findByTenant_IdAndActiveTrue(1L)).thenReturn(Optional.empty());

    DashboardResponse d = dashboardService.build(1L);

    assertThat(d.fiscalAlerts()).anyMatch(a -> "fiscalNoActiveStamp".equals(a.messageKey()));
    assertThat(d.fiscalAlerts().stream().anyMatch(a -> "blocking".equals(a.severity()))).isTrue();
  }

  @Test
  void blockingAlertWhenStampExpired() {
    when(businessProfileService.isRucReadyForInvoicing(1L)).thenReturn(true);
    FiscalStamp stamp = activeStamp();
    stamp.setValidUntil(LocalDate.of(2020, 1, 1));
    when(fiscalStampRepository.findByTenant_IdAndActiveTrue(1L)).thenReturn(Optional.of(stamp));

    DashboardResponse d = dashboardService.build(1L);

    assertThat(d.fiscalAlerts()).anyMatch(a -> "fiscalExpiredOrExhausted".equals(a.messageKey()));
  }

  @Test
  void noExpiryOrRangeAlertsWhenStampHasNoEndOrUpperNumber() {
    // Issue #290: "fin de vigencia" and "número hasta" are optional.
    when(businessProfileService.isRucReadyForInvoicing(1L)).thenReturn(true);
    FiscalStamp stamp = activeStamp();
    stamp.setValidUntil(null);
    stamp.setRangeTo(null);
    stamp.setNextEmissionNumber(5000);
    when(fiscalStampRepository.findByTenant_IdAndActiveTrue(1L)).thenReturn(Optional.of(stamp));

    DashboardResponse d = dashboardService.build(1L);

    assertThat(d.fiscalAlerts())
        .noneMatch(
            a ->
                List.of("fiscalExpiredOrExhausted", "fiscalExpiringSoon", "fiscalLowRange")
                    .contains(a.messageKey()));
  }

  @Test
  void exposesDistinctClientsWithAppointmentsThisMonth() {
    when(businessProfileService.isRucReadyForInvoicing(1L)).thenReturn(false);
    when(fiscalStampRepository.findByTenant_IdAndActiveTrue(1L)).thenReturn(Optional.empty());
    when(appointmentRepository.countDistinctClientsWithAppointmentsBetween(eq(1L), any(), any()))
        .thenReturn(15L);

    DashboardResponse d = dashboardService.build(1L);

    assertThat(d.clientsThisMonth()).isEqualTo(15L);
  }

  @Test
  void warningWhenExpiringSoon() {
    when(businessProfileService.isRucReadyForInvoicing(1L)).thenReturn(true);
    FiscalStamp stamp = activeStamp();
    stamp.setValidFrom(LocalDate.of(2024, 1, 1));
    stamp.setValidUntil(LocalDate.now(ZONE).plusDays(10));
    stamp.setRangeFrom(1);
    stamp.setRangeTo(100);
    stamp.setNextEmissionNumber(50);
    when(fiscalStampRepository.findByTenant_IdAndActiveTrue(1L)).thenReturn(Optional.of(stamp));

    DashboardResponse d = dashboardService.build(1L);

    assertThat(d.fiscalAlerts()).anyMatch(a -> "fiscalExpiringSoon".equals(a.messageKey()));
  }

  @Test
  void warningWhenNumberVoidingsPending() {
    when(businessProfileService.isRucReadyForInvoicing(1L)).thenReturn(true);
    when(fiscalStampRepository.findByTenant_IdAndActiveTrue(1L))
        .thenReturn(Optional.of(activeStamp()));
    when(sifenNumberVoidingService.pendingSummary(1L))
        .thenReturn(
            Optional.of(
                new SifenNumberVoidingService.PendingVoidingSummary(
                    2, LocalDate.now(ZONE).plusDays(10))));

    DashboardResponse d = dashboardService.build(1L);

    assertThat(d.fiscalAlerts()).anyMatch(a -> "sifenVoidingPending".equals(a.messageKey()));
  }

  @Test
  void warningWhenNumberVoidingsOverdue() {
    when(businessProfileService.isRucReadyForInvoicing(1L)).thenReturn(true);
    when(fiscalStampRepository.findByTenant_IdAndActiveTrue(1L))
        .thenReturn(Optional.of(activeStamp()));
    when(sifenNumberVoidingService.pendingSummary(1L))
        .thenReturn(
            Optional.of(
                new SifenNumberVoidingService.PendingVoidingSummary(
                    1, LocalDate.now(ZONE).minusDays(1))));

    DashboardResponse d = dashboardService.build(1L);

    assertThat(d.fiscalAlerts()).anyMatch(a -> "sifenVoidingOverdue".equals(a.messageKey()));
    assertThat(d.fiscalAlerts()).noneMatch(a -> "sifenVoidingPending".equals(a.messageKey()));
  }

  private static FiscalStamp activeStamp() {
    Tenant t = new Tenant();
    t.setId(1L);
    FiscalStamp s = new FiscalStamp();
    s.setTenant(t);
    s.setStampNumber("1");
    s.setValidFrom(LocalDate.of(2024, 1, 1));
    s.setValidUntil(LocalDate.of(2030, 1, 1));
    s.setRangeFrom(1);
    s.setRangeTo(100);
    s.setNextEmissionNumber(1);
    s.setActive(true);
    return s;
  }
}
