package com.cursorpoc.backend.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record AppointmentUpdateRequest(
    Long clientId,
    @NotNull Long professionalId,
    @NotNull Long serviceId,
    @NotBlank String startAt) {}
