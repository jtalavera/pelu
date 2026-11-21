package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.Appointment;
import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.ProfessionalSchedule;
import com.cursorpoc.backend.domain.enums.AppointmentStatus;
import com.cursorpoc.backend.repository.AppointmentRepository;
import com.cursorpoc.backend.repository.ProfessionalRepository;
import com.cursorpoc.backend.repository.ProfessionalScheduleRepository;
import com.cursorpoc.backend.service.AvailabilityService.DayPart;
import com.cursorpoc.backend.service.AvailabilityService.ProfessionalSlots;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class AvailabilityServiceTest {

  private static final long TENANT = 7L;

  /** A Monday far in the future, so «now» never gets in the way unless a test sets it. */
  private static final LocalDate MONDAY = LocalDate.of(2099, 6, 15);

  private final ProfessionalRepository professionals = mock(ProfessionalRepository.class);
  private final ProfessionalScheduleRepository schedules =
      mock(ProfessionalScheduleRepository.class);
  private final AppointmentRepository appointments = mock(AppointmentRepository.class);
  private final FemmeTimeProperties time = new FemmeTimeProperties();
  private final ZoneId zone = time.zoneId();
  private final AvailabilityService service =
      new AvailabilityService(professionals, schedules, appointments, time);

  private Professional ana;
  private Professional beto;

  @BeforeEach
  void setUp() {
    ana = professional(1, "Ana", true);
    beto = professional(2, "Beto", true);
    when(professionals.findByTenant_IdOrderByFullNameAsc(TENANT)).thenReturn(List.of(ana, beto));
    when(schedules.findByProfessionalIdInOrderByDayOfWeekAscIdAsc(any()))
        .thenReturn(
            List.of(
                block(ana, 1, "09:00", "12:00"),
                block(ana, 1, "14:00", "16:00"),
                block(beto, 1, "09:00", "10:00")));
    when(appointments.findInRangeFiltered(eq(TENANT), any(), any(), any(), any()))
        .thenReturn(List.of());
  }

  private static Professional professional(long id, String name, boolean active) {
    Professional p = new Professional();
    p.setId(id);
    p.setFullName(name);
    p.setActive(active);
    return p;
  }

  private static ProfessionalSchedule block(Professional p, int day, String from, String to) {
    ProfessionalSchedule s = new ProfessionalSchedule();
    s.setProfessional(p);
    s.setDayOfWeek((short) day);
    s.setStartTime(LocalTime.parse(from));
    s.setEndTime(LocalTime.parse(to));
    return s;
  }

  private Instant at(String hhmm) {
    return MONDAY.atTime(LocalTime.parse(hhmm)).atZone(zone).toInstant();
  }

  private Appointment busy(Professional p, String from, String to, AppointmentStatus status) {
    Appointment a = new Appointment();
    a.setProfessional(p);
    a.setStartAt(at(from));
    a.setEndAt(at(to));
    a.setStatus(status);
    return a;
  }

  private List<String> times(List<ProfessionalSlots> all, long professionalId) {
    return all.stream()
        .filter(p -> p.professionalId() == professionalId)
        .flatMap(p -> p.slots().stream())
        .map(s -> s.time().toString())
        .toList();
  }

  private List<ProfessionalSlots> day(int minutes, Long pro, DayPart part, int max) {
    return service.forDay(TENANT, MONDAY, minutes, pro, part, Instant.EPOCH, max);
  }

  // ---------------------------------------------------------------------------------------------

  @Test
  void slotsFollowTheWorkingBlocks_everyThirtyMinutes_andTheServiceMustFitInsideThem() {
    List<ProfessionalSlots> all = day(60, null, DayPart.ANY, 50);

    // 60-minute service: the last start of each block leaves room for the whole hour.
    assertThat(times(all, 1))
        .containsExactly("09:00", "09:30", "10:00", "10:30", "11:00", "14:00", "14:30", "15:00");
    assertThat(times(all, 2)).containsExactly("09:00");
  }

  @Test
  void aBusyAppointmentRemovesEverySlotThatWouldOverlapIt_butBackToBackIsFine() {
    when(appointments.findInRangeFiltered(eq(TENANT), any(), any(), any(), any()))
        .thenReturn(List.of(busy(ana, "10:00", "10:30", AppointmentStatus.CONFIRMED)));

    List<String> anas = times(day(30, 1L, DayPart.ANY, 50), 1);

    assertThat(anas).doesNotContain("10:00").contains("09:30", "10:30");
  }

  @Test
  void aCancelledAppointmentFreesItsSlot_aNoShowDoesNot() {
    when(appointments.findInRangeFiltered(eq(TENANT), any(), any(), any(), any()))
        .thenReturn(
            List.of(
                busy(ana, "09:00", "09:30", AppointmentStatus.CANCELLED),
                busy(ana, "10:00", "10:30", AppointmentStatus.NO_SHOW)));

    List<String> anas = times(day(30, 1L, DayPart.ANY, 50), 1);

    assertThat(anas).contains("09:00").doesNotContain("10:00");
  }

  @Test
  void aBusyAppointmentOfAnotherProfessionalDoesNotAffectHer() {
    when(appointments.findInRangeFiltered(eq(TENANT), any(), any(), any(), any()))
        .thenReturn(List.of(busy(beto, "09:00", "10:00", AppointmentStatus.PENDING)));

    assertThat(times(day(30, null, DayPart.ANY, 50), 1)).contains("09:00");
    assertThat(times(day(30, null, DayPart.ANY, 50), 2)).isEmpty();
  }

  @Test
  void theDayPartFiltersTheStartTimes() {
    assertThat(times(day(30, 1L, DayPart.MORNING, 50), 1)).allMatch(t -> t.compareTo("12:00") < 0);
    assertThat(times(day(30, 1L, DayPart.AFTERNOON, 50), 1))
        .containsExactly("14:00", "14:30", "15:00", "15:30");
  }

  @Test
  void atMostMaxSlotsPerProfessional_theEarliestOnes() {
    assertThat(times(day(30, 1L, DayPart.ANY, 3), 1)).containsExactly("09:00", "09:30", "10:00");
  }

  @Test
  void onTheDayItself_nothingBeforeNowIsOffered() {
    List<ProfessionalSlots> all =
        service.forDay(TENANT, MONDAY, 30, 1L, DayPart.ANY, at("10:15"), 50);

    assertThat(times(all, 1)).startsWith("10:30").doesNotContain("09:00", "10:00");
  }

  @Test
  void aDayThatIsNotAWorkingDay_hasNoSlots_butTheProfessionalDoesHaveAnAgenda() {
    List<ProfessionalSlots> tuesday =
        service.forDay(TENANT, MONDAY.plusDays(1), 30, 1L, DayPart.ANY, Instant.EPOCH, 50);

    assertThat(tuesday)
        .singleElement()
        .satisfies(
            p -> {
              assertThat(p.slots()).isEmpty();
              assertThat(p.hasSchedule()).isTrue();
            });
  }

  @Test
  void aProfessionalWithNoHoursLoadedAtAll_isReportedAsSuchAndOfferedNothing() {
    Professional carla = professional(3, "Carla", true);
    when(professionals.findByTenant_IdOrderByFullNameAsc(TENANT)).thenReturn(List.of(ana, carla));

    List<ProfessionalSlots> all = day(30, null, DayPart.ANY, 50);

    ProfessionalSlots carlaSlots =
        all.stream().filter(p -> p.professionalId() == 3).findFirst().orElseThrow();
    assertThat(carlaSlots.hasSchedule()).isFalse();
    assertThat(carlaSlots.slots()).isEmpty();
  }

  @Test
  void inactiveProfessionalsAreNotOffered() {
    when(professionals.findByTenant_IdOrderByFullNameAsc(TENANT))
        .thenReturn(List.of(ana, professional(4, "Inactiva", false)));

    assertThat(day(30, null, DayPart.ANY, 50))
        .extracting(ProfessionalSlots::professionalId)
        .containsExactly(1L);
  }

  @Test
  void nextDayWithSlots_skipsDaysWithoutRoom() {
    // Only Mondays have hours: from a Monday, the next free day is the following Monday.
    assertThat(service.nextDayWithSlots(TENANT, MONDAY, 30, 1L, DayPart.ANY, Instant.EPOCH, 14))
        .contains(MONDAY.plusDays(7));
    assertThat(service.nextDayWithSlots(TENANT, MONDAY, 30, 1L, DayPart.ANY, Instant.EPOCH, 3))
        .isEmpty();
  }

  @Test
  void workingHoursCheck_isInsideOneBlock_andLenientWithoutAnyHours() {
    when(schedules.findByProfessionalIdOrderByDayOfWeekAscIdAsc(1L))
        .thenReturn(List.of(block(ana, 1, "09:00", "12:00")));
    when(schedules.findByProfessionalIdOrderByDayOfWeekAscIdAsc(9L)).thenReturn(List.of());

    assertThat(service.isWithinWorkingHours(1L, at("09:00"), at("09:30"))).isTrue();
    assertThat(service.isWithinWorkingHours(1L, at("11:30"), at("12:30"))).isFalse();
    assertThat(service.isWithinWorkingHours(1L, at("20:00"), at("20:30"))).isFalse();
    assertThat(service.isWithinWorkingHours(9L, at("20:00"), at("20:30"))).isTrue();
  }

  // ---------------------------------------------------------------------------------------------

  @Test
  void theSharedOverlapRule_isHalfOpen_andOnlyCancelledFreesASlot() {
    Instant s = at("10:00");
    Instant e = at("10:30");

    assertThat(AppointmentConflictChecker.intervalsOverlap(s, e, at("10:30"), at("11:00")))
        .isFalse();
    assertThat(AppointmentConflictChecker.intervalsOverlap(s, e, at("10:29"), at("11:00")))
        .isTrue();
    assertThat(AppointmentConflictChecker.intervalsOverlap(s, e, at("09:00"), at("10:01")))
        .isTrue();
    assertThat(AppointmentConflictChecker.blocks(AppointmentStatus.CANCELLED)).isFalse();
    assertThat(AppointmentConflictChecker.blocks(AppointmentStatus.NO_SHOW)).isTrue();
    assertThat(AppointmentConflictChecker.blocks(AppointmentStatus.COMPLETED)).isTrue();
  }

  @Test
  void requireNoOverlap_throwsTheSame409TheBookingRoadAlwaysDid() {
    AppointmentRepository repo = mock(AppointmentRepository.class);
    when(repo.countOverlapping(
            eq(TENANT), eq(1L), any(), any(), eq(null), eq(AppointmentStatus.CANCELLED)))
        .thenReturn(1L);
    AppointmentConflictChecker checker = new AppointmentConflictChecker(repo);

    assertThatThrownBy(() -> checker.requireNoOverlap(TENANT, 1L, at("10:00"), at("10:30"), null))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("APPOINTMENT_OVERLAP");
    assertThat(checker.overlaps(TENANT, 2L, at("10:00"), at("10:30"), null)).isFalse();
  }

  @Test
  void isFree_usesTheServiceDuration() {
    when(appointments.countOverlapping(
            eq(TENANT),
            eq(1L),
            eq(at("10:00")),
            eq(at("10:00").plus(Duration.ofMinutes(45))),
            eq(null),
            any()))
        .thenReturn(1L);

    assertThat(service.isFree(TENANT, 1L, at("10:00"), 45, null)).isFalse();
    assertThat(service.isFree(TENANT, 1L, at("10:00"), 30, null)).isTrue();
  }
}
