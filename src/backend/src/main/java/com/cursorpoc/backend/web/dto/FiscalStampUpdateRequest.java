package com.cursorpoc.backend.web.dto;

import jakarta.validation.constraints.NotNull;
import java.time.LocalDate;

public record FiscalStampUpdateRequest(
    @NotNull LocalDate validFrom,
    @NotNull LocalDate validUntil,
    @NotNull Integer nextEmissionNumber) {}
