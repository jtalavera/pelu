package com.cursorpoc.backend.web.dto;

import java.math.BigDecimal;

public record InvoiceLineResponse(
    Long id,
    Long serviceId,
    String description,
    int quantity,
    BigDecimal unitPrice,
    BigDecimal lineTotal) {}
