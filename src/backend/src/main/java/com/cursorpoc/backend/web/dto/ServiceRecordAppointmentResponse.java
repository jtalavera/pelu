package com.cursorpoc.backend.web.dto;

import java.time.Instant;

/** A turno a ficha de servicio belongs to (a ficha may serve several turnos). */
public record ServiceRecordAppointmentResponse(Long id, Instant startAt) {}
