package com.cursorpoc.backend.web.dto;

import java.math.BigDecimal;
import java.time.Instant;

public record TipWithdrawalHistoryItemResponse(
    Long id, String professionalName, BigDecimal amount, Instant withdrawnAt) {}
