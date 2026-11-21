package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.Appointment;
import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.ProfessionalSchedule;
import com.cursorpoc.backend.repository.AppointmentRepository;
import com.cursorpoc.backend.repository.ProfessionalRepository;
import com.cursorpoc.backend.repository.ProfessionalScheduleRepository;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Free start times per professional for a day, from what the agenda really holds: the
 * professional's weekly working hours ({@link ProfessionalSchedule}), her non-cancelled
 * appointments (same overlap rule as booking, {@link AppointmentConflictChecker}) and «now» when
 * the day is today. Reusable outside the chat. There are no absences or holidays in the data model,
 * so none are considered. A professional with NO working hours loaded at all is reported as such
 * and offered no slots.
 */
@Service
public class AvailabilityService {

  /** Candidate start times are every 30 minutes inside a working block. */
  static final int STEP_MINUTES = 30;

  public enum DayPart {
    ANY,
    MORNING,
    AFTERNOON;

    public static DayPart parse(String raw) {
      if (raw == null) {
        return ANY;
      }
      return switch (raw.trim().toUpperCase()) {
        case "MORNING", "MANANA", "MAÑANA" -> MORNING;
        case "AFTERNOON", "TARDE" -> AFTERNOON;
        default -> ANY;
      };
    }
  }

  public record Slot(LocalTime time, Instant startAt) {}

  public record ProfessionalSlots(
      long professionalId, String professionalName, boolean hasSchedule, List<Slot> slots) {}

  private final ProfessionalRepository professionalRepository;
  private final ProfessionalScheduleRepository scheduleRepository;
  private final AppointmentRepository appointmentRepository;
  private final AppointmentConflictChecker conflictChecker;
  private final FemmeTimeProperties timeProperties;

  public AvailabilityService(
      ProfessionalRepository professionalRepository,
      ProfessionalScheduleRepository scheduleRepository,
      AppointmentRepository appointmentRepository,
      FemmeTimeProperties timeProperties) {
    this.professionalRepository = professionalRepository;
    this.scheduleRepository = scheduleRepository;
    this.appointmentRepository = appointmentRepository;
    this.conflictChecker = new AppointmentConflictChecker(appointmentRepository);
    this.timeProperties = timeProperties;
  }

  /**
   * Free slots of {@code date} for a service lasting {@code durationMinutes}, for every active
   * professional (or just {@code professionalId}), at most {@code maxPerProfessional} each.
   */
  @Transactional(readOnly = true)
  public List<ProfessionalSlots> forDay(
      long tenantId,
      LocalDate date,
      int durationMinutes,
      Long professionalId,
      DayPart part,
      Instant now,
      int maxPerProfessional) {
    ZoneId zone = timeProperties.zoneId();
    List<Professional> professionals =
        professionalRepository.findByTenant_IdOrderByFullNameAsc(tenantId).stream()
            .filter(Professional::isActive)
            .filter(p -> professionalId == null || p.getId().equals(professionalId))
            .toList();
    if (professionals.isEmpty()) {
      return List.of();
    }
    List<Long> ids = professionals.stream().map(Professional::getId).toList();
    Map<Long, List<ProfessionalSchedule>> schedules = new HashMap<>();
    for (ProfessionalSchedule s :
        scheduleRepository.findByProfessionalIdInOrderByDayOfWeekAscIdAsc(ids)) {
      schedules.computeIfAbsent(s.getProfessional().getId(), k -> new ArrayList<>()).add(s);
    }
    Instant dayStart = date.atStartOfDay(zone).toInstant();
    Instant dayEnd = date.plusDays(1).atStartOfDay(zone).toInstant();
    Map<Long, List<Appointment>> busy = new HashMap<>();
    for (Appointment a :
        appointmentRepository.findInRangeFiltered(
            tenantId, dayStart, dayEnd, professionalId, null)) {
      if (AppointmentConflictChecker.blocks(a.getStatus())) {
        busy.computeIfAbsent(a.getProfessional().getId(), k -> new ArrayList<>()).add(a);
      }
    }

    List<ProfessionalSlots> out = new ArrayList<>();
    for (Professional p : professionals) {
      List<ProfessionalSchedule> all = schedules.getOrDefault(p.getId(), List.of());
      if (all.isEmpty()) {
        out.add(new ProfessionalSlots(p.getId(), p.getDisplayName(), false, List.of()));
        continue;
      }
      List<Slot> slots = new ArrayList<>();
      for (ProfessionalSchedule block : all) {
        if (block.getDayOfWeek() != date.getDayOfWeek().getValue()) {
          continue;
        }
        int endMinute = block.getEndTime().toSecondOfDay() / 60;
        for (int m = block.getStartTime().toSecondOfDay() / 60;
            m + durationMinutes <= endMinute;
            m += STEP_MINUTES) {
          LocalTime time = LocalTime.ofSecondOfDay(m * 60L);
          Instant start = date.atTime(time).atZone(zone).toInstant();
          Instant end = start.plus(Duration.ofMinutes(durationMinutes));
          if (start.isBefore(now) || !matches(part, time)) {
            continue;
          }
          boolean taken =
              busy.getOrDefault(p.getId(), List.of()).stream()
                  .anyMatch(
                      a ->
                          AppointmentConflictChecker.intervalsOverlap(
                              start, end, a.getStartAt(), a.getEndAt()));
          if (!taken) {
            slots.add(new Slot(time, start));
          }
        }
      }
      slots.sort((a, b) -> a.startAt().compareTo(b.startAt()));
      out.add(
          new ProfessionalSlots(
              p.getId(),
              p.getDisplayName(),
              true,
              slots.size() > maxPerProfessional ? slots.subList(0, maxPerProfessional) : slots));
    }
    return out;
  }

  /** The first day after {@code after} (within {@code daysAhead}) that has any free slot. */
  @Transactional(readOnly = true)
  public Optional<LocalDate> nextDayWithSlots(
      long tenantId,
      LocalDate after,
      int durationMinutes,
      Long professionalId,
      DayPart part,
      Instant now,
      int daysAhead) {
    for (int i = 1; i <= daysAhead; i++) {
      LocalDate day = after.plusDays(i);
      if (forDay(tenantId, day, durationMinutes, professionalId, part, now, 1).stream()
          .anyMatch(p -> !p.slots().isEmpty())) {
        return Optional.of(day);
      }
    }
    return Optional.empty();
  }

  /** The slot is free for that professional (same rule as booking). */
  public boolean isFree(
      long tenantId, long professionalId, Instant start, int durationMinutes, Long excludeId) {
    return !conflictChecker.overlaps(
        tenantId,
        professionalId,
        start,
        start.plus(Duration.ofMinutes(durationMinutes)),
        excludeId);
  }

  /**
   * Whether {@code [start, end)} lies inside one of her working blocks of that day. A professional
   * with no hours loaded at all counts as «inside»: nothing to compare with (the manual agenda does
   * not restrict her either).
   */
  @Transactional(readOnly = true)
  public boolean isWithinWorkingHours(long professionalId, Instant start, Instant end) {
    ZoneId zone = timeProperties.zoneId();
    var s = start.atZone(zone);
    var e = end.atZone(zone);
    List<ProfessionalSchedule> all =
        scheduleRepository.findByProfessionalIdOrderByDayOfWeekAscIdAsc(professionalId);
    if (all.isEmpty()) {
      return true;
    }
    return all.stream()
        .filter(b -> b.getDayOfWeek() == s.getDayOfWeek().getValue())
        .anyMatch(
            b ->
                s.toLocalDate().equals(e.toLocalDate())
                    && !s.toLocalTime().isBefore(b.getStartTime())
                    && !e.toLocalTime().isAfter(b.getEndTime()));
  }

  private static boolean matches(DayPart part, LocalTime time) {
    return switch (part) {
      case ANY -> true;
      case MORNING -> time.isBefore(LocalTime.NOON);
      case AFTERNOON -> !time.isBefore(LocalTime.NOON);
    };
  }
}
