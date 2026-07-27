package com.cursorpoc.backend.web.dto;

import java.math.BigDecimal;

public record CreateTipWithdrawalResponse(
    TipWithdrawalHistoryItemResponse withdrawal, BigDecimal newBalance) {}
