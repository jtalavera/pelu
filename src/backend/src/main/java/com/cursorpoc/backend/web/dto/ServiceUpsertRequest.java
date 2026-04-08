package com.cursorpoc.backend.web.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;

public record ServiceUpsertRequest(
    @NotBlank String name,
    @NotNull Long categoryId,
    @NotNull @Min(0) BigDecimal priceMinor,
    @Min(1) int durationMinutes) {}
