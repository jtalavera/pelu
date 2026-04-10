package com.cursorpoc.backend.web.dto;

import java.math.BigDecimal;
import java.time.Instant;

public record InvoiceListItemResponse(
    Long id,
    int invoiceNumber,
    String invoiceNumberFormatted,
    String clientDisplayName,
    String status,
    BigDecimal total,
    Instant issuedAt,
    String servicesSummary,
    String paymentMethodsSummary) {}
