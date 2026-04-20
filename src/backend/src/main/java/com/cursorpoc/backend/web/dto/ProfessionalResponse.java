package com.cursorpoc.backend.web.dto;

import java.time.LocalTime;
import java.util.List;

public record ProfessionalResponse(
    long id,
    String fullName,
    String phone,
    String email,
    String photoDataUrl,
    boolean active,
    List<Schedule> schedules,
    boolean hasPinSet,
    boolean systemAccessAllowed,
    boolean hasUserAccount) {
  public record Schedule(short dayOfWeek, LocalTime startTime, LocalTime endTime) {}
}
