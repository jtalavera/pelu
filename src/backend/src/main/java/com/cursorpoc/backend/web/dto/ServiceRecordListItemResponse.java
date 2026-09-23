package com.cursorpoc.backend.web.dto;

import java.math.BigDecimal;
import java.time.Instant;

public record ServiceRecordListItemResponse(
    Long id,
    Long clientId,
    String clientFullName,
    String status,
    BigDecimal totalAmount,
    Instant createdAt) {}
