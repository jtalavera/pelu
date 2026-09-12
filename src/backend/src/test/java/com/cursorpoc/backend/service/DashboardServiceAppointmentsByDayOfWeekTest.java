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
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.temporal.TemporalAdjusters;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
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

  private static Instant onDay(DayOfWeek dow, int hour) {
    return onDay(dow, hour, 0);
  }

  private static Instant onDay(DayOfWeek dow, int hour, int minute) {
    ZonedDateTime day =
        ZonedDateTime.now(ZONE)
            .with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
            .with(dow)
            .withHour(hour)
            .withMinute(minute)
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
  void bucketsALateNightAppointmentByTheLocalDayNotTheUtcDay() {
    // 23:45 Wednesday in America/Asuncion (UTC-3, no DST) is already Thursday in UTC (02:45Z) —
    // this proves the bucketing converts via the business `ZoneId` (as production code does with
    // `startAt.atZone(zone).getDayOfWeek()`), not a naive UTC-based day-of-week that would land
    // this on Thursday instead.
    Instant wednesdayLateNight = onDay(DayOfWeek.WEDNESDAY, 23, 45);
    assertThat(wednesdayLateNight.atZone(ZoneId.of("UTC")).getDayOfWeek())
        .as("sanity check: this instant really is a different UTC calendar day")
        .isEqualTo(DayOfWeek.THURSDAY);

    when(appointmentRepository.findStartAtsByTenantAndStatusInAndStartAtBetween(
            eq(1L), any(), any(), any()))
        .thenReturn(List.of(wednesdayLateNight));

    DashboardResponse d = dashboardService.build(1L);

    var byKey =
        d.appointmentsByDayOfWeek().stream()
            .collect(
                java.util.stream.Collectors.toMap(
                    DashboardResponse.AppointmentsByDayOfWeek::dayOfWeek,
                    DashboardResponse.AppointmentsByDayOfWeek::count));
    assertThat(byKey.get("wed")).isEqualTo(1L);
    assertThat(byKey.get("thu")).isEqualTo(0L);
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

    // Same formula as the private `DashboardService.revenueWindow` (business-zone start-of-day of
    // `today - (REVENUE_TREND_DAYS - 1)` through start-of-day of `today + 1`, exclusive) —
    // recomputed independently here (rather than via reflection into the private helper) since
    // that's the one other public surface (`REVENUE_TREND_DAYS`) this test can anchor on.
    LocalDate today = LocalDate.now(ZONE);
    Instant expectedFrom =
        today.minusDays(DashboardService.REVENUE_TREND_DAYS - 1L).atStartOfDay(ZONE).toInstant();
    Instant expectedTo = today.plusDays(1).atStartOfDay(ZONE).toInstant();

    dashboardService.build(1L);

    ArgumentCaptor<Instant> fromCaptor = ArgumentCaptor.forClass(Instant.class);
    ArgumentCaptor<Instant> toCaptor = ArgumentCaptor.forClass(Instant.class);
    Mockito.verify(appointmentRepository)
        .findStartAtsByTenantAndStatusInAndStartAtBetween(
            eq(1L), any(), fromCaptor.capture(), toCaptor.capture());

    assertThat(fromCaptor.getValue()).isEqualTo(expectedFrom);
    assertThat(toCaptor.getValue()).isEqualTo(expectedTo);
  }
}
