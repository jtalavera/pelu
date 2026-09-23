package com.cursorpoc.backend.web.dto;

import java.math.BigDecimal;
import java.time.Instant;

public record CashSessionListItemResponse(
    Long id,
    Instant openedAt,
    Instant closedAt,
    String openedByEmail,
    String closedByEmail,
    BigDecimal openingCashAmount,
    BigDecimal countedCashAmount,
    BigDecimal expectedCashAmount,
    BigDecimal cashDifference,
    boolean isOpen) {}
