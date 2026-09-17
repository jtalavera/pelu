package com.cursorpoc.backend.web.dto;

public record AppointmentResponse(
    long id,
    Long clientId,
    String clientName,
    long professionalId,
    String professionalName,
    long serviceId,
    String serviceName,
    int durationMinutes,
    String startAt,
    String endAt,
    String status,
    String cancelReason,
    // Issue #218 follow-up: null until the ~24h-ahead reminder email has actually been sent for
    // this appointment's current startAt slot (AppointmentReminderScheduler).
    String reminderSentAt) {}
