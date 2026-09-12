package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.enums.AppointmentStatus;
import com.cursorpoc.backend.repository.AppointmentRepository;
import com.cursorpoc.backend.repository.ClientRepository;
import com.cursorpoc.backend.repository.FiscalStampRepository;
import com.cursorpoc.backend.repository.InvoiceRepository;
import com.cursorpoc.backend.web.dto.DashboardResponse;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.Mockito;
import org.mockito.junit.jupiter.MockitoExtension;

/**
 * Issue #222 — "Dashboard: gráfico de turnos por día de semana": unit coverage of {@link
 * DashboardService#buildAppointmentsByDayOfWeek} (exercised indirectly via {@link
 * DashboardService#build}, same style as the sibling chart tests for issues #219-#221).
 */
@ExtendWith(MockitoExtension.class)
class DashboardServiceAppointmentsByDayOfWeekTest {

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

  /** A Monday 10:00 in the business timezone, as an {@link Instant}. */
  private static Instant mondayAt(int hour) {
    ZonedDateTime monday =
        ZonedDateTime.now(ZONE)
            .with(java.time.temporal.TemporalAdjusters.previousOrSame(java.time.DayOfWeek.MONDAY))
            .withHour(hour)
            .withMinute(0)
            .withSecond(0)
            .withNano(0);
    return monday.toInstant();
  }

  private static Instant onDay(java.time.DayOfWeek dow, int hour) {
    ZonedDateTime day =
        ZonedDateTime.now(ZONE)
            .with(java.time.temporal.TemporalAdjusters.previousOrSame(java.time.DayOfWeek.MONDAY))
            .with(dow)
            .withHour(hour)
            .withMinute(0)
            .withSecond(0)
            .withNano(0);
    return day.toInstant();
  }

  @Test
  void alwaysReturnsSevenDaysMondayFirstZeroFilledWhenNoAppointments() {
    when(appointmentRepository.findStartAtsByTenantAndStatusInAndStartAtBetween(
            eq(1L), any(), any(), any()))
        .thenReturn(List.of());

    DashboardResponse d = dashboardService.build(1L);

    assertThat(d.appointmentsByDayOfWeek())
        .extracting(DashboardResponse.AppointmentsByDayOfWeek::dayOfWeek)
        .containsExactly("mon", "tue", "wed", "thu", "fri", "sat", "sun");
    assertThat(d.appointmentsByDayOfWeek())
        .extracting(DashboardResponse.AppointmentsByDayOfWeek::count)
        .containsExactly(0L, 0L, 0L, 0L, 0L, 0L, 0L);
  }

  @Test
  void bucketsCountsByBusinessTimezoneDayOfWeek() {
    when(appointmentRepository.findStartAtsByTenantAndStatusInAndStartAtBetween(
            eq(1L), any(), any(), any()))
        .thenReturn(
            List.of(
                mondayAt(9),
                mondayAt(15),
                onDay(java.time.DayOfWeek.WEDNESDAY, 11),
                onDay(java.time.DayOfWeek.FRIDAY, 18)));

    DashboardResponse d = dashboardService.build(1L);

    var byKey =
        d.appointmentsByDayOfWeek().stream()
            .collect(
                java.util.stream.Collectors.toMap(
                    DashboardResponse.AppointmentsByDayOfWeek::dayOfWeek,
                    DashboardResponse.AppointmentsByDayOfWeek::count));
    assertThat(byKey.get("mon")).isEqualTo(2L);
    assertThat(byKey.get("wed")).isEqualTo(1L);
    assertThat(byKey.get("fri")).isEqualTo(1L);
    assertThat(byKey.get("tue")).isEqualTo(0L);
    assertThat(byKey.get("thu")).isEqualTo(0L);
    assertThat(byKey.get("sat")).isEqualTo(0L);
    assertThat(byKey.get("sun")).isEqualTo(0L);
  }

  @Test
  void queriesOnlyCountableStatusesExcludingCancelledAndNoShow() {
    when(appointmentRepository.findStartAtsByTenantAndStatusInAndStartAtBetween(
            eq(1L), any(), any(), any()))
        .thenReturn(List.of());

    dashboardService.build(1L);

    Mockito.verify(appointmentRepository)
        .findStartAtsByTenantAndStatusInAndStartAtBetween(
            eq(1L),
            eq(
                List.of(
                    AppointmentStatus.PENDING,
                    AppointmentStatus.CONFIRMED,
                    AppointmentStatus.IN_PROGRESS,
                    AppointmentStatus.COMPLETED)),
            any(),
            any());
  }

  @Test
  void queriesTheSameTrailingWindowAsRevenueTrend() {
    when(appointmentRepository.findStartAtsByTenantAndStatusInAndStartAtBetween(
            eq(1L), any(), any(), any()))
        .thenReturn(List.of());

    dashboardService.build(1L);

    Mockito.verify(appointmentRepository)
        .findStartAtsByTenantAndStatusInAndStartAtBetween(eq(1L), any(), any(), any());
  }
}
