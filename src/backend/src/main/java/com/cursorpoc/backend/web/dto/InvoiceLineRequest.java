package com.cursorpoc.backend.web.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;

public record InvoiceLineRequest(
    Long serviceId,
    /** SIFEN HU-03 AC-02: up to 2000 chars to detail the service prestado. */
    @NotBlank @Size(max = 2000) String description,
    @Min(1) int quantity,
    @NotNull @Min(0) BigDecimal unitPrice,
    /** Optional per-line discount type: FIXED or PERCENT (null = no discount). */
    String discountType,
    /** Optional per-line discount value (null when discountType is null). */
    BigDecimal discountValue) {}
