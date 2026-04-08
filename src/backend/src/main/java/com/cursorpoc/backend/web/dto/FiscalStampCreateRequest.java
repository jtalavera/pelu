package com.cursorpoc.backend.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.LocalDate;

public record FiscalStampCreateRequest(
    @NotBlank String stampNumber,
    @NotNull LocalDate validFrom,
    @NotNull LocalDate validUntil,
    @NotNull Integer rangeFrom,
    @NotNull Integer rangeTo,
    @NotNull Integer initialEmissionNumber) {}
