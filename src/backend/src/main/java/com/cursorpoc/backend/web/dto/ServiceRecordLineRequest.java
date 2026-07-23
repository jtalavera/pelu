package com.cursorpoc.backend.web.dto;

import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;

public record ServiceRecordLineRequest(
    @NotNull Long serviceId,
    @NotNull Long professionalId,
    @NotNull Integer quantity,
    @NotNull BigDecimal unitPrice) {}
