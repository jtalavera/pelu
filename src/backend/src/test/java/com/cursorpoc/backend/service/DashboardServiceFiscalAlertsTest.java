package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.FiscalStamp;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.repository.AppointmentRepository;
import com.cursorpoc.backend.repository.FiscalStampRepository;
import com.cursorpoc.backend.repository.InvoiceRepository;
import com.cursorpoc.backend.web.dto.DashboardResponse;
import java.time.LocalDate;
import java.time.ZoneId;
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
  @Mock private InvoiceRepository invoiceRepository;
  @Mock private FiscalStampRepository fiscalStampRepository;
  @Mock private BusinessProfileService businessProfileService;

  private DashboardService dashboardService;

  @BeforeEach
  void setUp() {
    FemmeTimeProperties time = new FemmeTimeProperties();
    time.setBusinessZoneId(ZONE.getId());
    dashboardService =
        new DashboardService(
            time, appointmentRepository, invoiceRepository, fiscalStampRepository, businessProfileService);
  }

  @Test
  void blockingAlertWhenNoActiveStampAndRucReady() {
    when(businessProfileService.isRucReadyForInvoicing(1L)).thenReturn(true);
    when(fiscalStampRepository.findByTenant_IdAndActiveTrue(1L)).thenReturn(Optional.empty());

    DashboardResponse d = dashboardService.build(1L);

    assertThat(d.fiscalAlerts()).anyMatch(a -> "fiscalNoActiveStamp".equals(a.messageKey()));
    assertThat(d.fiscalAlerts().stream().anyMatch(a -> "blocking".equals(a.severity())))
        .isTrue();
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
