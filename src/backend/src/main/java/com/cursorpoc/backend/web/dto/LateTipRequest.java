package com.cursorpoc.backend.web.dto;

import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;

/**
 * One tip left after the invoice was issued. Only the professional is bean-validated; amount and
 * payment data are checked in the service so each failure answers with its own error code.
 */
public record LateTipRequest(
    @NotNull Long professionalId,
    BigDecimal amount,
    String paymentMethod,
    String cardBrand,
    String cardBrandOtherDescription) {}
