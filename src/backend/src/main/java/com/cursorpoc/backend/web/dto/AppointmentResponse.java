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
    String cancelReason) {}
