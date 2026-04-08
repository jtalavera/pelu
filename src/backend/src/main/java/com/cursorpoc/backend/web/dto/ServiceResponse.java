package com.cursorpoc.backend.web.dto;

import java.math.BigDecimal;

public record ServiceResponse(
    long id,
    long categoryId,
    String categoryName,
    String name,
    BigDecimal priceMinor,
    int durationMinutes,
    boolean active) {}

