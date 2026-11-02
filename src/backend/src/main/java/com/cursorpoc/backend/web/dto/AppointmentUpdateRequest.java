package com.cursorpoc.backend.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record AppointmentUpdateRequest(
    Long clientId,
    @NotNull Long professionalId,
    @NotNull Long serviceId,
    @NotBlank String startAt,
    /**
     * Optional length of the turno in minutes (5–480, e.g. when it runs long). Defaults to the
     * service's own duration.
     */
    Integer durationMinutes) {

  public AppointmentUpdateRequest(
      Long clientId, Long professionalId, Long serviceId, String startAt) {
    this(clientId, professionalId, serviceId, startAt, null);
  }
}
