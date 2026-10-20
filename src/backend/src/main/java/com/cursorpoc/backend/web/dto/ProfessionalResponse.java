package com.cursorpoc.backend.web.dto;

import java.time.Instant;
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
    boolean hasUserAccount,
    // Issue #38 (4)/(5): NO_ACCESS | INVITATION_SENT | INVITATION_EXPIRED | ACTIVE, plus what the
    // status line and the resend button need. All null in the professional-facing directory.
    String accessStatus,
    String accessLoginEmail,
    Instant invitationSentAt,
    Instant invitationExpiresAt,
    Instant resendAvailableAt) {
  public record Schedule(short dayOfWeek, LocalTime startTime, LocalTime endTime) {}
}
