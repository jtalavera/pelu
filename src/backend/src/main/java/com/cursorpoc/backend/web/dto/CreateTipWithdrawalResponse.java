package com.cursorpoc.backend.web.dto;

import java.math.BigDecimal;

/**
 * {@code cashSessionId} is the register the withdrawal was recorded on (null when the tenant has
 * never had one); {@code afterClose} is true when that register was already closed.
 */
public record CreateTipWithdrawalResponse(
    TipWithdrawalHistoryItemResponse withdrawal,
    BigDecimal newBalance,
    Long cashSessionId,
    boolean afterClose) {}
