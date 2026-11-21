package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.enums.AppointmentStatus;
import com.cursorpoc.backend.repository.AppointmentRepository;
import java.time.Instant;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/**
 * THE overlap rule of the agenda, in one place so booking ({@link AppointmentService}) and
 * availability ({@link AvailabilityService}) can never diverge: a professional cannot have two
 * non-cancelled appointments that overlap (intervals are half-open: back-to-back is fine). A
 * NO_SHOW still blocks its slot; only CANCELLED frees it.
 */
public class AppointmentConflictChecker {

  private final AppointmentRepository appointmentRepository;

  public AppointmentConflictChecker(AppointmentRepository appointmentRepository) {
    this.appointmentRepository = appointmentRepository;
  }

  /** Whether the status keeps its slot occupied. */
  public static boolean blocks(AppointmentStatus status) {
    return status != AppointmentStatus.CANCELLED;
  }

  /** Half-open overlap: {@code [s1,e1)} and {@code [s2,e2)} share time. */
  public static boolean intervalsOverlap(Instant s1, Instant e1, Instant s2, Instant e2) {
    return s1.isBefore(e2) && e1.isAfter(s2);
  }

  public boolean overlaps(
      long tenantId, long professionalId, Instant startAt, Instant endAt, Long excludeId) {
    return appointmentRepository.countOverlapping(
            tenantId, professionalId, startAt, endAt, excludeId, AppointmentStatus.CANCELLED)
        > 0;
  }

  /** 409 {@code APPOINTMENT_OVERLAP} when the slot is taken. */
  public void requireNoOverlap(
      long tenantId, long professionalId, Instant startAt, Instant endAt, Long excludeId) {
    if (overlaps(tenantId, professionalId, startAt, endAt, excludeId)) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "APPOINTMENT_OVERLAP");
    }
  }
}
