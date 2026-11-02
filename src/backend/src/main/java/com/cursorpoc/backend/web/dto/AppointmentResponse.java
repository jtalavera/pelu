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
    String reminderSentAt,
    // HU-69: the client's birthday falls on this appointment's day (server zone). Shown as a cake
    // icon to admins and professionals alike — it never reveals the date or the age.
    boolean clientBirthdayOnDay,
    // The ficha de servicio of this turno (null while it has none): the Inicio and the Agenda show
    // "Crear o asignar ficha" or "Ir a la ficha" from it.
    Long serviceRecordId) {}
