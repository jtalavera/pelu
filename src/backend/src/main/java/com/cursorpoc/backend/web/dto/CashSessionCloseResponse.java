package com.cursorpoc.backend.web.dto;

import java.math.BigDecimal;
import java.time.Instant;

public record CashSessionCloseResponse(
    Long id,
    Long tenantId,
    Instant openedAt,
    Instant closedAt,
    String closedByEmail,
    BigDecimal openingCashAmount,
    BigDecimal countedCashAmount,
    BigDecimal expectedCashAmount,
    BigDecimal cashDifference,
    BigDecimal totalInvoiced,
    int invoiceCount,
    java.util.List<PaymentMethodSummary> paymentSummary) {

  public record PaymentMethodSummary(String method, BigDecimal total) {}
}
