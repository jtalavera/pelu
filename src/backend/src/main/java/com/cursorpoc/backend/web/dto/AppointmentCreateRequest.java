package com.cursorpoc.backend.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record AppointmentCreateRequest(
    Long clientId,
    @NotNull Long professionalId,
    @NotNull Long serviceId,
    @NotBlank String startAt) {}
