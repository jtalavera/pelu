package com.cursorpoc.backend.web.dto;

import java.math.BigDecimal;

public record ServiceRecordLineResponse(
    Long id,
    Long serviceId,
    String description,
    BigDecimal unitPrice,
    Integer quantity,
    BigDecimal lineTotal,
    Long professionalId,
    String professionalName) {}
