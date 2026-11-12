package com.cursorpoc.backend.web.dto;

import java.math.BigDecimal;
import java.time.Instant;

public record ManualTipResponse(
    Long id,
    Long professionalId,
    String professionalName,
    BigDecimal amount,
    Instant tippedAt,
    String note,
    String createdByName,
    boolean voided,
    String voidReason,
    String voidedByName) {}
