package com.cursorpoc.backend.web.dto;

import com.cursorpoc.backend.domain.enums.CashMovementType;
import java.math.BigDecimal;
import java.time.Instant;

public record CashMovementResponse(
    Long id,
    Long cashSessionId,
    CashMovementType type,
    BigDecimal amount,
    String reason,
    String createdByEmail,
    Instant createdAt,
    Long tipWithdrawalId) {}
