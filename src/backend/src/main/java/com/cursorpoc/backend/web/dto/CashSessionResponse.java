package com.cursorpoc.backend.web.dto;

import java.math.BigDecimal;
import java.time.Instant;

public record CashSessionResponse(
    Long id,
    Long tenantId,
    Long openedByUserId,
    String openedByEmail,
    Instant openedAt,
    BigDecimal openingCashAmount,
    boolean isOpen) {}
