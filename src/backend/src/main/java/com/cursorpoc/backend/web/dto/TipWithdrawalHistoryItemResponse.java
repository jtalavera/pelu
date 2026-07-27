package com.cursorpoc.backend.web.dto;

import java.math.BigDecimal;
import java.time.Instant;

public record TipWithdrawalHistoryItemResponse(Long id, BigDecimal amount, Instant withdrawnAt) {}
