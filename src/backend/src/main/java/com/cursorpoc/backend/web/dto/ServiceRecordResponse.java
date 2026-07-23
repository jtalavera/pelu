package com.cursorpoc.backend.web.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

public record ServiceRecordResponse(
    Long id,
    Long clientId,
    String clientFullName,
    String clientRuc,
    String status,
    BigDecimal totalAmount,
    BigDecimal tipsTotal,
    String voidReason,
    Instant createdAt,
    Instant closedAt,
    Long invoiceId,
    String invoiceNumberFormatted,
    List<ServiceRecordLineResponse> lines,
    List<ServiceRecordTipResponse> tips) {}
