package com.cursorpoc.backend.web.dto;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;

public record CashSessionCloseRequest(
    @NotNull @DecimalMin(value = "0.00") BigDecimal countedCashAmount) {}
