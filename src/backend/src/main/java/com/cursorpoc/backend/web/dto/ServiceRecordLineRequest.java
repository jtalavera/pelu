package com.cursorpoc.backend.web.dto;

import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;

public record ServiceRecordLineRequest(
    @NotNull Long serviceId, Long professionalId, Integer quantity, BigDecimal unitPrice) {}
