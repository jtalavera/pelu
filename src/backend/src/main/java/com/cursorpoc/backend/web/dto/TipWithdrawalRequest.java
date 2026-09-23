package com.cursorpoc.backend.web.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;

public record TipWithdrawalRequest(
    @NotNull Long professionalId, @NotNull @Min(1) BigDecimal amount) {}
