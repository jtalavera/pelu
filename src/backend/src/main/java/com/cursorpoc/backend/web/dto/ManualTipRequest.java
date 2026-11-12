package com.cursorpoc.backend.web.dto;

import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.time.Instant;

/**
 * Body of {@code POST /api/propinas/manual}. Only the professional is bean-validated; amount, date
 * and note are checked in the service so each failure answers with its own error code.
 */
public record ManualTipRequest(
    @NotNull Long professionalId, BigDecimal amount, Instant tippedAt, String note) {}
