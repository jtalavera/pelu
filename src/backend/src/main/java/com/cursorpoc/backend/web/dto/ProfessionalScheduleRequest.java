package com.cursorpoc.backend.web.dto;

import jakarta.validation.constraints.NotNull;
import java.time.LocalTime;

public record ProfessionalScheduleRequest(
    @NotNull Short dayOfWeek, @NotNull LocalTime startTime, @NotNull LocalTime endTime) {}
