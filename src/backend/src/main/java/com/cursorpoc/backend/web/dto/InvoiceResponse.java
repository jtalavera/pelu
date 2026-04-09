package com.cursorpoc.backend.web.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

public record InvoiceResponse(
    Long id,
    int invoiceNumber,
    String invoiceNumberFormatted,
    String fiscalStampNumber,
    Long clientId,
    String clientDisplayName,
    String clientRucOverride,
    String status,
    BigDecimal subtotal,
    String discountType,
    BigDecimal discountValue,
    BigDecimal total,
    Instant issuedAt,
    Long cashSessionId,
    String voidReason,
    List<InvoiceLineResponse> lines,
    List<InvoicePaymentAllocationResponse> payments) {}
