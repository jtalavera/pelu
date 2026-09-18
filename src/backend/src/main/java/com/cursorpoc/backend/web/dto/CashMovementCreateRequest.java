package com.cursorpoc.backend.web.dto;

import com.cursorpoc.backend.domain.enums.CashMovementType;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;

public record CashMovementCreateRequest(
    @NotNull CashMovementType type,
    @NotNull @DecimalMin(value = "0.01") BigDecimal amount,
    @NotBlank @Size(max = 500) String reason) {}
