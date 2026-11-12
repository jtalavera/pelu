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
    boolean isOpen,
    List<LateTipSummary> lateTips) {

  public record PaymentMethodSummary(String method, BigDecimal total) {}

  /**
   * A tip left after its invoice was issued that entered this register (HU-73). Voided ones are
   * listed, flagged, but never counted in the expected cash nor in the per-method breakdown.
   */
  public record LateTipSummary(
      Long id,
      String professionalName,
      String invoiceNumberFormatted,
      BigDecimal amount,
      String paymentMethod,
      String cardBrand,
      Instant createdAt,
      String createdByEmail,
      boolean voided,
      String voidReason,
      String voidedByEmail) {}
}
