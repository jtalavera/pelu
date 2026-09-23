package com.cursorpoc.backend.web.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

public record CashSessionDetailResponse(
    Long id,
    Long tenantId,
    Instant openedAt,
    String openedByEmail,
    Instant closedAt,
    String closedByEmail,
    BigDecimal openingCashAmount,
    BigDecimal countedCashAmount,
    BigDecimal expectedCashAmount,
    BigDecimal cashDifference,
    BigDecimal totalInvoiced,
    int invoiceCount,
    List<PaymentMethodSummary> paymentSummary,
    List<CashMovementResponse> movements,
    boolean isOpen) {

  public record PaymentMethodSummary(String method, BigDecimal total) {}
}
