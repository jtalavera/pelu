package com.cursorpoc.backend.web.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;

/** Tip for one professional who served a line of the comprobante (never part of the total). */
public record InvoiceTipRequest(@NotNull Long professionalId, @NotNull @Min(0) BigDecimal amount) {}
