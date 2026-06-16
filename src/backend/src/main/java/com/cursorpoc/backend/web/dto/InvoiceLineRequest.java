package com.cursorpoc.backend.web.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;

public record InvoiceLineRequest(
    Long serviceId,
    @NotBlank String description,
    @Min(1) int quantity,
    @NotNull @Min(0) BigDecimal unitPrice,
    /** Optional per-line discount type: FIXED or PERCENT (null = no discount). */
    String discountType,
    /** Optional per-line discount value (null when discountType is null). */
    BigDecimal discountValue) {}
